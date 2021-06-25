import type {
  Expression,
  MathJsonNumber,
  MathJsonSymbol,
  MathJsonFunction,
  MathJsonString,
} from '../public';
import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';

import { gcd } from '../compute-engine/numeric';

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
export const UNDEFINED = 'Undefined';
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

export function isFunctionObject<T extends number = number>(
  expr: Expression<T> | null
): expr is MathJsonFunction<T> {
  return expr !== null && typeof expr === 'object' && 'fn' in expr;
}

export function isDictionaryObject<T extends number = number>(
  expr: Expression<T>
): expr is MathJsonNumber {
  return expr !== null && typeof expr === 'object' && 'dict' in expr;
}

// Return a `number` if the expression is:
// - a machine number
// - a `Complex` with an imaginary value of 0
// Otherwise, return `null`.
export function getNumberValue<T extends number = number>(
  expr: Expression<T> | null
): number | null {
  if (expr === null) return null;
  if (typeof expr === 'number') return expr;

  if (isNumberObject(expr)) {
    if (expr.num.endsWith('d') || expr.num.endsWith('n')) return null;
    return parseFloat(expr.num);
  }

  const name = getFunctionName(expr);
  if (name === NEGATE) {
    // The `-` sign is not considered part of numbers when parsed, instead a
    // ['Negate'...] is generated. This is to correctly support `-1^2`
    const val = getNumberValue(getArg(expr, 1));
    return val === null ? null : -val;
  } else if (name === 'Complex') {
    if (getNumberValue(getArg(expr, 2)) === 0) {
      return getNumberValue(getArg(expr, 1));
    }
  }

  const symbol = getSymbolName(expr);
  if (symbol === 'NaN') return NaN;
  if (symbol === '+Infinity') return Infinity;
  if (symbol === '-Infinity') return -Infinity;

  return null;
}

/**
 * Only return non-null if the expression is a Complex number.
 * Return `null` if it's a machine number, a decimal, a symbol other than
 * `ImaginaryUnit` or `ComplexInfinity` or something else.
 *
 */
export function getComplexValue(
  expr: Complex | Expression | null
): Complex | null {
  if (expr === null) return null;
  if (expr instanceof Complex) return expr;

  const symbol = getSymbolName(expr);
  if (symbol !== null) {
    if (symbol === 'ComplexInfinity') return Complex.INFINITY;
    if (symbol === IMAGINARY_UNIT) return Complex.I;
  }

  const name = getFunctionName(expr);
  if (name === 'Complex') {
    const re1 = getNumberValue(getArg(expr, 1));
    const im1 = getNumberValue(getArg(expr, 2));
    if (re1 === null || im1 === null) return null;
    return new Complex(re1, im1);
  }

  let im = getImaginaryValue(expr);
  if (im !== null) return new Complex(0, im);

  if (name === 'Add' && getArgCount(expr) === 2) {
    let re = getNumberValue(getArg(expr, 1));
    if (re !== null) {
      im = getImaginaryValue(getArg(expr, 2));
    } else {
      im = getImaginaryValue(getArg(expr, 1));
      if (im !== null) {
        re = getNumberValue(getArg(expr, 2));
      }
    }

    if (re !== null && im !== null) return new Complex(re, im);
  }

  if (name === 'Subtract') {
    const re = getNumberValue(getArg(expr, 1));
    const arg2 = getArg(expr, 2);
    if (re !== null) {
      if (getSymbolName(arg2) === IMAGINARY_UNIT) {
        return new Complex(re, -1);
      }
      if (
        getFunctionName(arg2) === 'Multiply' &&
        getArg(arg2, 2) === IMAGINARY_UNIT
      ) {
        const im = getNumberValue(getArg(arg2, 1));
        if (im !== null) return new Complex(re, -im);
      }
    }
  }

  if (name === 'Multiply' && getArgCount(expr) === 2) {
    let factor: number | null = null;
    if (getSymbolName(getArg(expr, 2)) === IMAGINARY_UNIT) {
      factor = getNumberValue(getArg(expr, 2));
    } else if (getSymbolName(getArg(expr, 1)) === IMAGINARY_UNIT) {
      factor = getNumberValue(getArg(expr, 1));
    }
    if (factor !== null && Number.isInteger(factor)) {
      if (factor === 0) return Complex.ZERO;
      if (factor === 1) return Complex.ONE;
      if (factor === -1) return Complex.ONE.neg();
      return new Complex(0, factor);
    }
  }

  if (name === 'Negate') {
    const c = getComplexValue(getArg(expr, 1));
    if (c !== null) return c.neg();
  }

  return null;
}

/**
 * Return a multiple of the imaginary unit, e.g.
 * - 'ImaginaryUnit'
 * - ['Negate', 'ImaginaryUnit']
 * - ['Multiply', 5, 'ImaginaryUnit']
 * - ['Multiply', 'ImaginaryUnit', 5]
 */
export function getImaginaryValue(expr: Expression): number | null {
  if (getSymbolName(expr) === 'ImaginaryUnit') return 1;

  let val: number | null = null;
  const name = getFunctionName(expr);
  if (name === 'Multiply' && getArgCount(expr) === 2) {
    if (getSymbolName(getArg(expr, 1)) === 'ImaginaryUnit') {
      val = getNumberValue(getArg(expr, 2));
    } else if (getSymbolName(getArg(expr, 2)) === 'ImaginaryUnit') {
      val = getNumberValue(getArg(expr, 1));
    }
  } else if (name === 'Negate' && getArgCount(expr) === 1) {
    val = getImaginaryValue(getArg(expr, 1)!);
    if (val !== null) return -val;
  }
  return val === 0 ? null : val;
}

export function getDecimalValue(
  expr: Decimal | Expression | null
): Decimal | null {
  if (expr === null) return null;
  if (expr instanceof Decimal) return expr;

  if (
    isNumberObject(expr) &&
    (expr.num.endsWith('d') || expr.num.endsWith('n'))
  ) {
    return new Decimal(expr.num.slice(0, -1));
  }

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
export function getRationalValue(
  expr: Expression
): [number, number] | [null, null] {
  const symbol = getSymbolName(expr);
  if (symbol === 'ThreeQuarter') return [3, 4];
  if (symbol === 'TwoThird') return [2, 3];
  if (symbol === 'Half') return [1, 2];
  if (symbol === 'Third') return [1, 3];
  if (symbol === 'Quarter') return [1, 4];

  if (isAtomic(expr)) return [null, null];

  const head = getFunctionName(expr);
  if (!head) return [null, null];

  let numer: number | null = null;
  let denom: number | null = null;

  if (head === NEGATE) {
    [numer, denom] = getRationalValue(getArg(expr, 1) ?? MISSING);
    if (numer !== null && denom !== null) {
      return [-numer, denom];
    }
  }

  if (head === POWER) {
    const exponent = getNumberValue(getArg(expr, 2));
    if (exponent === 1) {
      numer = getNumberValue(getArg(expr, 1)) ?? null;
      denom = 1;
    } else if (exponent === -1) {
      numer = 1;
      denom = getNumberValue(getArg(expr, 1)) ?? null;
    }
  }

  if (head === DIVIDE) {
    numer = getNumberValue(getArg(expr, 1)) ?? null;
    denom = getNumberValue(getArg(expr, 2)) ?? null;
  }

  if (
    head === MULTIPLY &&
    getFunctionName(getArg(expr, 2)) === POWER &&
    getNumberValue(getArg(getArg(expr, 2), 2)) === -1
  ) {
    numer = getNumberValue(getArg(expr, 1)) ?? null;
    denom = getNumberValue(getArg(getArg(expr, 2), 1)) ?? null;
  }

  if (numer === null || denom === null) return [null, null];

  if (Number.isInteger(numer) && Number.isInteger(denom)) {
    return [numer, denom];
  }
  return [null, null];
}

/**
 *  Reduce the numerator and denominator:
 * `\frac{2}{4} -> \frac{1}{2})`
 */
export function simplifyRational([numer, denom]:
  | [number, number]
  | [null, null]): [number, number] | [null, null] {
  if (numer === null || denom === null) return [null, null];
  const g = gcd(numer, denom);
  if (denom < 0) return [-numer / g, -denom / g];
  return [numer / g, denom / g];
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
): [number, number] | [null, null] {
  if (getSymbolName(expr) === symbol) return [1, 1];

  const head = getFunctionName(expr);
  if (head === MULTIPLY) {
    // p/q * symbol
    if (getSymbolName(getArg(expr, 2) ?? MISSING) !== symbol) {
      return [null, null];
    }
    const arg1 = getArg(expr, 1);
    const val = getNumberValue(arg1);
    if (val !== null) return [val, 1];
    return getRationalValue(arg1 ?? MISSING);
  } else if (head === DIVIDE) {
    const denom = getNumberValue(getArg(expr, 2) ?? MISSING);
    if (denom === null || isNaN(denom)) return [null, null];
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
      if (getFunctionName(arg1) !== MULTIPLY) return [null, null];
      if (getSymbolName(getArg(arg1, 2)) !== symbol) return [null, null];

      numer = getNumberValue(getArg(arg1, 1));
    }
    if (numer === null) return [null, null];
    return [numer, denom];
  } else if (head === NEGATE) {
    const [numer, denom] = getRationalSymbolicValue(
      getArg(expr, 1) ?? MISSING,
      symbol
    );
    if (numer === null || isNaN(numer)) return [null, null];
    return [-numer!, denom!];
  }

  return [null, null];
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
 * The head of a function can be a string or an expression.
 *
 * Return `null` if the expression is not a function.
 *
 * Examples:
 * * `["Negate", 5]`  -> `"Negate"`
 * * `[["Prime", "f"], "x"]` -> `["Prime", "f"]`
 */
export function getFunctionHead<T extends number = number>(
  expr: Expression<T> | null
): Expression<T> | null {
  if (expr === null) return null;
  if (Array.isArray(expr)) return expr[0];
  if (isFunctionObject(expr)) return expr.fn[0];
  return null;
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

export function getFunctionName<T extends number = number>(
  expr: Expression<T> | null
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
  | 'Complement'
  | 'Cosh'
  | 'Exp'
  | 'Re'
  | 'And'
  | 'Or'
  | 'Not'
  | 'Equal'
  | 'Less'
  | 'LessEqual'
  | 'Greater'
  | 'GreaterEqual'
  | 'NotEqual'
  | 'Set'
  | 'Element'
  | 'Subset'
  | 'NotElement'
  | 'Complex'
  | 'Hold'
  | 'Evaluate'
  | 'Range'
  | 'Interval'
  | 'Open'
  | 'Multiple'
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
export function getTail<T extends number = number>(
  expr: Expression<T> | null
): Expression<T>[] {
  if (Array.isArray(expr)) {
    return expr.slice(1);
  }
  if (isFunctionObject(expr)) {
    return expr.fn.slice(1);
  }
  return [];
}

export function applyRecursively<T extends number = number>(
  expr: Expression<T>,
  fn: (x: Expression<T>) => Expression<T>
): Expression<T> {
  const head = getFunctionHead<T>(expr);
  if (head !== null) {
    return [fn(head), ...getTail(expr).map(fn)];
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

export function getArg<T extends number = number>(
  expr: Expression<T> | null,
  n: number
): Expression<T> | null {
  if (expr === null) return null;

  if (Array.isArray(expr)) return expr[n] ?? null;

  if (isFunctionObject(expr)) return expr.fn[n] ?? null;

  return null;
}

export function getArgCount<T extends number = number>(
  expr: Expression<T>
): number {
  if (Array.isArray(expr)) {
    return Math.max(0, expr.length - 1);
  }
  if (isFunctionObject(expr)) {
    return Math.max(0, expr.fn.length - 1);
  }
  return 0;
}

export function getDictionary<T extends number = number>(
  expr: Expression<T>
): { [key: string]: Expression<T> } | null {
  if (typeof expr === 'object' && 'dict' in expr) return expr.dict;
  return null;
}

/**
 * Structurally compare two expressions, ignoring metadata.
 *
 * Compare with `match()` which ignores differences in representation.
 *
 * @revisit: is this really needed? Or just use `match()`?
 */
export function equalExpr<T extends number = number>(
  lhs: Expression<T> | null,
  rhs: Expression<T> | null
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
export type FilteredNumerics = {
  others: Expression[];
  numbers: number[];
  decimals: Decimal[];
  complexes: Complex[];
  rationals: [numer: number, denom: number][];
};
export function filterNumerics(args: Expression[]): FilteredNumerics {
  const result: FilteredNumerics = {
    others: [],
    numbers: [],
    decimals: [],
    complexes: [],
    rationals: [],
  };
  for (const arg of args) {
    const val = getNumberValue(arg);
    if (val !== null) {
      result.numbers.push(val);
    } else {
      const [numer, denom] = getRationalValue(arg);
      if (numer !== null && denom !== null) {
        result.rationals.push([numer, denom]);
      } else {
        const d = getDecimalValue(arg);
        if (d) {
          result.decimals.push(d);
        } else {
          const c = getComplexValue(arg);
          if (c !== null) {
            result.complexes.push(c);
          } else {
            result.others.push(arg);
          }
        }
      }
    }
  }
  return result;
}
