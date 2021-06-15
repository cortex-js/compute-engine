import {
  Expression,
  MathJsonRealNumber,
  MathJsonSymbol,
  MathJsonFunction,
  MathJsonString,
} from '../public';

/**
 * These constants are the 'primitive' functions and constants that are used
 * for some basic manipulations such as parsing, and transforming to canonical
 * form.
 *
 */
export const PARENTHESES = 'Parentheses';
export const IDENTITY = 'Identity';
export const LATEX_TOKENS = 'LatexTokens';
export const LIST = 'List';
export const MISSING = 'Missing';
export const NOTHING = 'Nothing';
export const SEQUENCE = 'Sequence';
export const SEQUENCE2 = 'Sequence2';

export const ADD = 'Add';
export const DERIVATIVE = 'Derivative';
export const DIVIDE = 'Divide';
export const EXP = 'Exp';
export const INVERSE_FUNCTION = 'InverseFunction';
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
export const IMAGINARY_I = 'ImaginaryI';

export function isNumberObject(
  expr: Expression | null
): expr is MathJsonRealNumber {
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

export function isDictionaryObject(
  expr: Expression
): expr is MathJsonRealNumber {
  return expr !== null && typeof expr === 'object' && 'dict' in expr;
}

export function getNumberValue(expr: Expression | null): number | null {
  if (typeof expr === 'number') return expr;
  if (expr === null) return null;

  if (isNumberObject(expr)) return parseFloat(expr.num);

  const symbol = getSymbolName(expr);
  if (symbol !== null) {
    if (symbol === '+Infinity') return Infinity;
    if (symbol === '-Infinity') return -Infinity;
  }

  // @todo: canonical form does not use Negate for negative numbers, so
  // this should not be needed
  // if (getFunctionName(expr) === NEGATE) return -getNumberValue(getArg(expr, 1));

  return null;
}

/**  If expr is a string literal, return it.
 *
 * A string literal is a JSON string that begins and ends with
 * **U+0027 APOSTROPHE** : **`'`** or an object literal with a `str` key.
 */
export function getStringValue(expr: Expression | null): string | null {
  if (expr === null) return null;
  if (typeof expr === 'object' && 'str' in expr) return expr.str;
  if (typeof expr !== 'string') return null;
  if (expr.length < 2) return null;
  if (expr[0] !== "'" || expr[expr.length - 1] !== "'") return null;
  return expr.substring(1, expr.length - 1);
}

/**
 * Return a rational (numer over denom) representation of the expression,
 * if possible, `[NaN, NaN]` otherwise.
 *
 * The expression can be:
 * - an integer
 * - ["Power", d, -1]
 * - ["Power", n, 1]
 * - ["Divide", n, d]
 * - ["Multiply", n, ["Power", d, -1]]
 *
 * The denominator is always > 0.
 * The numerator and denominator are reduced (i.e. \frac{2}{4} -> \frac{1}{2})
 */
export function getRationalValue(expr: Expression): [number, number] {
  if (typeof expr === 'number' && Number.isInteger(expr)) {
    return [expr, 1];
  }

  if (isNumberObject(expr)) {
    const val = getNumberValue(expr);
    if (val !== null && Number.isInteger(val)) return [val, 1];
  }

  const symbol = getSymbolName(expr);
  if (symbol === 'ThreeQuarter') return [3, 4];
  if (symbol === 'TwoThird') return [2, 3];
  if (symbol === 'Half') return [1, 2];
  if (symbol === 'Third') return [1, 3];
  if (symbol === 'Quarter') return [1, 4];

  if (isAtomic(expr)) return [NaN, NaN];

  const head = getFunctionName(expr);
  if (!head) return [NaN, NaN];

  let numer = NaN;
  let denom = NaN;

  if (head === POWER) {
    const exponent = getNumberValue(getArg(expr, 2));
    if (exponent === 1) {
      numer = getNumberValue(getArg(expr, 1)) ?? NaN;
      denom = 1;
    } else if (exponent === -1) {
      numer = 1;
      denom = getNumberValue(getArg(expr, 1)) ?? NaN;
    }
  }

  if (head === DIVIDE) {
    numer = getNumberValue(getArg(expr, 1)) ?? NaN;
    denom = getNumberValue(getArg(expr, 2)) ?? NaN;
  }

  if (
    head === MULTIPLY &&
    getFunctionName(getArg(expr, 2)) === POWER &&
    getNumberValue(getArg(getArg(expr, 2), 2)) === -1
  ) {
    numer = getNumberValue(getArg(expr, 1)) ?? NaN;
    denom = getNumberValue(getArg(getArg(expr, 2), 1)) ?? NaN;
  }

  if (Number.isInteger(numer) && Number.isInteger(denom)) {
    const g = gcd(numer, denom);
    if (denom < 0) return [-numer / g, -denom / g];
    return [numer / g, denom / g];
  }
  return [NaN, NaN];
}

/**
 * Return the numerator and denominator of a product with the specified symbol.
 * For example:
 * `3π` -> [3, 1]
 * `3π/2` -> [3, 2]
 * `1/2 * π` -> [1, 2]
 */
export function getRationalSymbolicValue(
  expr: Expression,
  symbol: string
): [number, number] {
  if (getSymbolName(expr) === symbol) return [1, 1];

  const head = getFunctionName(expr);
  if (head === MULTIPLY) {
    // p/q * symbol
    if (getSymbolName(getArg(expr, 2) ?? MISSING) !== symbol) return [NaN, NaN];
    return getRationalValue(getArg(expr, 1) ?? MISSING);
  } else if (head === DIVIDE) {
    const denom = getNumberValue(getArg(expr, 2) ?? MISSING);
    if (denom === null || isNaN(denom)) return [NaN, NaN];
    const arg1 = getArg(expr, 1) ?? MISSING;
    const sym1 = getSymbolName(arg1);
    if (sym1 === symbol) return [1, denom];
    let numer: number | null = null;
    if (sym1 === 'MinusDoublePi') {
      numer = -2;
    } else if (sym1 === 'MinusPi') {
      numer = -1;
    } else if (sym1 === 'DoublePi') {
      numer = 2;
    } else {
      if (getFunctionName(arg1) !== MULTIPLY) return [NaN, NaN];
      if (getSymbolName(getArg(arg1, 2)) !== symbol) return [NaN, NaN];

      numer = getNumberValue(getArg(arg1, 1));
    }
    if (numer === null) return [NaN, NaN];
    const g = gcd(numer, denom);
    if (denom < 0) return [-numer / g, -denom / g];
    return [numer / g, denom / g];
  } else if (head === NEGATE) {
    const [numer, denom] = getRationalSymbolicValue(
      getArg(expr, 1) ?? MISSING,
      symbol
    );
    if (isNaN(numer)) return [NaN, NaN];
    return [-numer, denom];
  }

  return [NaN, NaN];
}

/** True if the expression is of the form \frac{n}{m} where n and m are both integers
 *
 * Note this detects fewer patterns than `getRationalValue()`, but it is
 * intended to detect rational numbers used with invisible plus, i.e. `1\frac{1}{2}`
 *
 */
export function isRationalNumber(expr: Expression): boolean {
  const symbol = getSymbolName(expr);
  if (
    symbol !== null &&
    ['ThreeQuarter', 'TwoThird', 'Half', 'Third', 'Quarter'].includes(symbol)
  ) {
    return true;
  }
  if (getFunctionName(expr) !== DIVIDE) return false;
  const numer = getNumberValue(getArg(expr, 1)) ?? NaN;
  const denom = getNumberValue(getArg(expr, 2)) ?? NaN;
  return Number.isInteger(numer) && Number.isInteger(denom);
}

/**
 * Return the head of any expression, including symbols and numbers.
 *
 */
export function getHead(expr: Expression): Expression | null {
  if (Array.isArray(expr)) return expr[0];
  if (isFunctionObject(expr)) return expr.fn[0];

  if (typeof expr === 'number' || isNumberObject(expr)) {
    return 'Number';
  }

  if (typeof expr === 'string') return 'String';

  if (isSymbolObject(expr)) return 'Symbol';

  if (isDictionaryObject(expr)) return 'Dictionary';

  return null;
}

/**
 * The head of a function can either be a string or an expression.
 *
 * Return `null` if the expression is not a function.
 *
 * Examples:
 * * `["Negate", 5]`  -> `"Negate"`
 * * `[["Prime", "f"], "x"]` -> `["Prime", "f"]`
 */
export function getFunctionHead(expr: Expression | null): Expression | null {
  if (expr === null) return null;
  if (Array.isArray(expr)) return expr[0];
  if (isFunctionObject(expr)) return expr.fn[0];
  return null;
}

/**
 * True if the expression is a number, a symbol or a dictionary
 */
export function isAtomic(expr: Expression): boolean {
  return (
    expr === null ||
    (!Array.isArray(expr) &&
      (typeof expr !== 'object' || !('fn' in expr || 'dic' in expr)))
  );
}

export function getFunctionName(
  expr: Expression | null
):
  | typeof MULTIPLY
  | typeof POWER
  | typeof DIVIDE
  | typeof ADD
  | typeof SUBTRACT
  | typeof NEGATE
  | typeof DERIVATIVE
  | typeof INVERSE_FUNCTION
  | typeof LATEX_TOKENS
  | typeof SQRT
  | typeof ROOT
  | typeof PARENTHESES
  | typeof LIST
  | typeof MISSING
  | typeof PRIME
  | typeof IDENTITY
  | typeof NOTHING
  | typeof SEQUENCE
  | typeof SEQUENCE2
  | typeof PRIME
  | 'PartialDerivative'
  | 'Union'
  | 'Intersection'
  | 'SetMinus'
  | 'Cosh'
  | 'Exp'
  | 'Re'
  | '' {
  if (expr === null) return '';
  const head = getFunctionHead(expr);
  if (typeof head === 'string') return head as any;
  return '';
}

export function getSymbolName(expr: Expression | null): string | null {
  if (expr === null) return null;
  if (typeof expr === 'string') {
    if (expr.length >= 2 && expr[0] === "'" && expr[expr.length - 1] === "'") {
      // It's a string literal, not a symbol
      return null;
    }
    return expr;
  }

  if (isSymbolObject(expr)) return expr.sym;

  return null;
}

/**
 * Return all the elements but the first one, i.e. the arguments of a
 * function.
 */
export function getTail(expr: Expression | null): Expression[] {
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
  const head = getFunctionHead(expr);
  if (head !== null) {
    return [fn(head), ...getTail(expr).map((x) => fn(x))];
  }
  const dict = getDictionary(expr);
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

export function getArg(expr: Expression | null, n: number): Expression | null {
  if (expr === null) return null;
  if (Array.isArray(expr)) {
    return expr[n];
  }
  if (isFunctionObject(expr)) {
    return expr.fn[n];
  }
  return null;
}

export function getArgCount(expr: Expression): number {
  if (Array.isArray(expr)) {
    return Math.max(0, expr.length - 1);
  }
  if (isFunctionObject(expr)) {
    return Math.max(0, expr.fn.length - 1);
  }
  return 0;
}

export function getDictionary(
  expr: Expression
): { [key: string]: Expression } | null {
  if (typeof expr === 'object' && 'dict' in expr) return expr.dict;
  return null;
}

/**
 * Structurally compare two expressions, ignoring metadata.
 *
 * Compare with `same()` which ignores differences in representation.
 */
export function equalExpr(
  lhs: Expression | null,
  rhs: Expression | null
): boolean {
  if (typeof lhs !== typeof rhs) return false;
  if (lhs === null) return rhs === null;
  if (lhs === undefined) return rhs === undefined;
  if (typeof lhs === 'number') return lhs === rhs;
  if (typeof lhs === 'string') return lhs === rhs;

  if (Array.isArray(lhs) && Array.isArray(rhs)) {
    if (!equalExpr(getHead(lhs), getHead(rhs!))) return false;
    // Compare the arguments
    const count = getArgCount(lhs);
    if (getArgCount(rhs!) !== count) return false;
    for (let i = 0; i < count; i++) {
      if (!equalExpr(getArg(lhs, i), getArg(rhs, i))) return false;
    }
    return true;
  }

  if (typeof lhs === 'object') {
    if (isNumberObject(lhs) && isNumberObject(rhs!)) {
      return getNumberValue(lhs) === getNumberValue(rhs!);
    }

    if (isSymbolObject(lhs) && isSymbolObject(rhs!)) {
      return getSymbolName(lhs) === getSymbolName(rhs);
    }

    if (isFunctionObject(lhs) && isFunctionObject(rhs!)) {
      if (!equalExpr(getHead(lhs), getHead(rhs!))) return false;
      // Compare the arguments
      const count = getArgCount(lhs);
      if (getArgCount(rhs!) !== count) return false;
      for (let i = 0; i < count; i++) {
        if (!equalExpr(getArg(lhs, i), getArg(rhs, i))) return false;
      }
      return true;
    }

    if (isStringObject(lhs) && isStringObject(rhs!)) {
      return getStringValue(lhs) === getStringValue(rhs!);
    }

    if (isDictionaryObject(lhs) && isDictionaryObject(rhs!)) {
      const lhsDic = getDictionary(lhs);
      const rhsDic = getDictionary(rhs!);
      if (lhsDic === null && rhsDic !== null) return false;
      if (lhsDic === null && rhsDic === null) return true;
      const keys = Object.keys(lhsDic!);
      if (rhsDic === null || keys.length !== Object.keys(rhsDic!).length) {
        return false;
      }
      for (const key of keys) {
        if (!equalExpr(lhsDic![key], rhsDic![key])) return false;
      }
      return true;
    }
  }

  return false;
}

/**
 * Return the nth term in expr.
 * If expr is not a "add" function, returns null.
 */
// export function nth(_expr: Expression, _vars?: string[]): Expression {
//     return null;
// }

/**
 * Return the coefficient of the expression, assuming vars are variables.
 */
export function coef(_expr: Expression, _vars: string[]): Expression | null {
  // @todo
  return null;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}
