import {
  Expression,
  MathJsonRealNumber,
  MathJsonSymbol,
  MathJsonFunction,
} from '../public';

/**
 * These constants are the 'primitive' functions and constants that are used
 * for some basic manipulations such as parsing, and transforming to canonical
 * form.
 *
 */
export const GROUP = 'Group';
export const IDENTITY = 'Identity';
export const LATEX = 'Latex';
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

export function isNumberObject(expr: Expression): expr is MathJsonRealNumber {
  return Boolean(expr) && typeof expr === 'object' && 'num' in expr;
}

export function isSymbolObject(expr: Expression): expr is MathJsonSymbol {
  return Boolean(expr) && typeof expr === 'object' && 'sym' in expr;
}
export function isFunctionObject(expr: Expression): expr is MathJsonFunction {
  return Boolean(expr) && typeof expr === 'object' && 'fn' in expr;
}

export function getNumberValue(expr: Expression): number {
  if (typeof expr === 'number') {
    return expr;
  }
  if (isNumberObject(expr)) {
    return parseFloat(expr.num);
  }
  if (getFunctionName(expr) === NEGATE) {
    return -getNumberValue(getArg(expr, 1));
  }
  return NaN;
}

/**
 * Return a rational (numer over denom) representation of the expression,
 * if possible, `[NaN, NaN]` otherwise.
 *
 * The expression can be:
 * - a number
 * - ["Power", d, -1]
 * - ["Power", n, 1]
 * - ["Divide", n, d]
 * - ["Multiply", n, ["Power", d, -1]]
 */
export function getRationalValue(expr: Expression): [number, number] {
  let numer = NaN;
  let denom = NaN;

  if (typeof expr === 'number') {
    numer = expr;
    denom = 1;
  } else if (isNumberObject(expr)) {
    numer = getNumberValue(expr);
    denom = 1;
  } else if (isAtomic(expr)) {
    return [NaN, NaN];
  } else {
    const head = getFunctionName(expr);

    if (head === POWER) {
      const exponent = getNumberValue(getArg(expr, 2));
      if (exponent === 1) {
        numer = getNumberValue(getArg(expr, 1));
        denom = 1;
      } else if (exponent === -1) {
        numer = 1;
        denom = getNumberValue(getArg(expr, 1));
      } else {
        return [NaN, NaN];
      }
    } else if (head === DIVIDE) {
      numer = getNumberValue(getArg(expr, 1));
      denom = getNumberValue(getArg(expr, 2));
    } else if (
      head === MULTIPLY &&
      getFunctionName(getArg(expr, 2)) === POWER &&
      getNumberValue(getArg(getArg(expr, 2), 2)) === -1
    ) {
      numer = getNumberValue(getArg(expr, 1));
      denom = getNumberValue(getArg(getArg(expr, 2), 1));
    }
  }
  if (Number.isInteger(numer) && Number.isInteger(denom)) {
    if (denom < 0) {
      denom = -denom;
      numer = -numer;
    }
    return [numer, denom];
  }

  return [NaN, NaN];
}

/**
 * The head of an expression can either be a string or an expression.
 *
 * Examples:
 * * `["Negate", 5]`  -> "Negate"
 * * `[["Prime", "f"], "x"] -> `["Prime", "f"]
 */
export function getFunctionHead(expr: Expression): Expression {
  if (Array.isArray(expr)) {
    return expr[0];
  }
  if (isFunctionObject(expr)) {
    return expr.fn[0];
  }
  return null;
}

/**
 * True if the expression is a number or a symbol
 */
export function isAtomic(expr: Expression): boolean {
  return (
    expr === null ||
    (!Array.isArray(expr) && (typeof expr !== 'object' || !('fn' in expr)))
  );
}

export function getFunctionName(
  expr: Expression
):
  | typeof MULTIPLY
  | typeof POWER
  | typeof DIVIDE
  | typeof ADD
  | typeof SUBTRACT
  | typeof NEGATE
  | typeof DERIVATIVE
  | typeof INVERSE_FUNCTION
  | typeof LATEX
  | typeof SQRT
  | typeof ROOT
  | typeof GROUP
  | typeof LIST
  | typeof MISSING
  | typeof PRIME
  | typeof IDENTITY
  | typeof NOTHING
  | typeof SEQUENCE
  | typeof PRIME
  | ''
  | string {
  const head = getFunctionHead(expr);
  if (typeof head === 'string') return head as any;
  return '';
}

export function getSymbolName(expr: Expression): string | null {
  if (typeof expr === 'string') {
    return expr;
  }
  if (isSymbolObject(expr)) {
    return expr.sym;
  }
  return null;
}

/**
 * Return the arguments
 */
export function getArgs(expr: Expression): (Expression | null)[] {
  if (Array.isArray(expr)) {
    return expr.slice(1);
  }
  if (isFunctionObject(expr)) {
    return expr.fn.slice(1);
  }
  return [];
}

export function mapArgs(
  expr: Expression,
  fn: (x: Expression) => Expression
): Expression {
  if (Array.isArray(expr)) {
    return expr.map((x, i) => (i === 0 ? x : fn(x)));
  }
  if (isFunctionObject(expr)) {
    return expr.fn.map((x, i) => (i === 0 ? x : fn(x)));
  }
  return expr;
}

export function getArg(expr: Expression, n: number): Expression | null {
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

export function appendLatex(src: string, s: string): string {
  if (!s) return src;

  // If the source end in a Latex command,
  // and the appended string begins with a letter
  if (/\\[a-zA-Z]+\*?$/.test(src) && /[a-zA-Z*]/.test(s[0])) {
    // Add a space between them
    return src + ' ' + s;
  }
  // No space needed
  return src + s;
}

/**
 * Replace '#1', '#2' in the latex template stings with the corresponding
 * values from `replacement`, in a Latex syntax safe manner (i.e. inserting spaces when needed)
 */
export function replaceLatex(template: string, replacement: string[]): string {
  console.assert(typeof template === 'string');
  console.assert(template.length > 0);
  let result = template;
  for (let i = 0; i < replacement.length; i++) {
    let s = replacement[i] ?? '';
    if (/[a-zA-Z*]/.test(s[0])) {
      const m = result.match(new RegExp('(.*)#' + Number(i + 1).toString()));
      if (m && /\\[a-zA-Z*]+/.test(m[1])) {
        s = ' ' + s;
      }
    }
    result = result.replace('#' + Number(i + 1).toString(), s);
  }

  return result;
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
