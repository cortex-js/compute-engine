import { joinLatex } from '../latex-syntax/tokenizer';
import { DEFINITIONS_INEQUALITIES } from '../latex-syntax/dictionary/definitions-relational-operators';
import type { BoxedExpression, IComputeEngine, NumericFlags } from './public';
import { MACHINE_PRECISION } from '../numerics/numeric';

export function isBoxedExpression(x: unknown): x is BoxedExpression {
  return typeof x === 'object' && x !== null && 'engine' in x;
}

/**
 * For any numeric result, if `bignumPreferred()` is true, calculate using
 * bignums. If `bignumPreferred()` is false, calculate using machine numbers
 */
export function bignumPreferred(ce: IComputeEngine): boolean {
  return ce.precision > MACHINE_PRECISION;
}

export function isLatexString(s: unknown): s is string {
  if (typeof s === 'string') return s.startsWith('$') && s.endsWith('$');
  return false;
}

export function asLatexString(s: unknown): string | null {
  if (typeof s === 'number') return s.toString();
  if (typeof s === 'string') {
    const str = s.trim();

    if (str.startsWith('$$') && str.endsWith('$$')) return str.slice(2, -2);
    if (str.startsWith('$') && str.endsWith('$')) return str.slice(1, -1);
  }
  if (Array.isArray(s)) {
    // Check after 'string', since a string is also an array...
    return asLatexString(joinLatex(s));
  }
  return null;
}

export function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++)
    hash = (Math.imul(31, hash) + s.charCodeAt(i)) | 0; // | 0 to convert to 32-bit int

  return Math.abs(hash);
}

export function normalizedUnknownsForSolve(
  syms:
    | string
    | Iterable<string>
    | BoxedExpression
    | Iterable<BoxedExpression>
    | null
    | undefined
): string[] {
  if (syms === null || syms === undefined) return [];
  if (typeof syms === 'string') return [syms];
  if (isBoxedExpression(syms)) return normalizedUnknownsForSolve(syms.symbol);
  if (typeof syms[Symbol.iterator] === 'function')
    return Array.from(syms as Iterable<any>).map((s) =>
      typeof s === 'string' ? s : s.symbol
    );
  return [];
}

/** Return the local variables in the expression.
 *
 * A local variable is an identifier that is declared with a `Declare`
 * expression in a `Block` expression.
 *
 * Note that the canonical form of a `Block` expression will hoist all
 * `Declare` expressions to the top of the block. `Assign` expressions
 * of undeclared variables will also have a matching `Declare` expressions
 * hoisted.
 *
 */
// export function getLocalVariables(
//   expr: BoxedExpression,
//   result: Set<string>
// ): void {
//   const h = expr.op;
//   if (h !== 'Block') return;
//   for (const statement of expr.ops!)
//     if (statement.op === 'Declare') {
//       const id = statement.op1.symbol;
//       if (id) result.add(id);
//     }
// }

export function isRelationalOperator(name: BoxedExpression | string): boolean {
  if (typeof name !== 'string') return false;
  return DEFINITIONS_INEQUALITIES.some((x) => x.name === name);
}

export function isInequality(expr: BoxedExpression): boolean {
  const h = expr.operator;
  if (typeof h !== 'string') return false;
  return ['Less', 'LessEqual', 'Greater', 'GreaterEqual'].includes(h);
}

/**
 * Return a multiple of the imaginary unit, e.g.
 * - 'ImaginaryUnit'  -> 1
 * - ['Negate', 'ImaginaryUnit']  -> -1
 * - ['Negate', ['Multiply', 3, 'ImaginaryUnit']] -> -3
 * - ['Multiply', 5, 'ImaginaryUnit'] -> 5
 * - ['Multiply', 'ImaginaryUnit', 5] -> 5
 * - ['Divide', 'ImaginaryUnit', 2] -> 0.5
 *
 */
export function getImaginaryFactor(
  expr: BoxedExpression
): BoxedExpression | undefined {
  const ce = expr.engine;
  if (expr.symbol === 'ImaginaryUnit') return ce.One;

  if (expr.re === 0) return ce.number(expr.im!);

  if (expr.operator === 'Negate') return getImaginaryFactor(expr.op1)?.neg();

  if (expr.operator === 'Complex') {
    if (expr.op1.isZero && expr.op2.re !== undefined)
      return ce.number(expr.op2.re);
    return undefined;
  }

  if (expr.operator === 'Multiply' && expr.nops === 2) {
    const [op1, op2] = expr.ops!;
    if (op1.symbol === 'ImaginaryUnit') return op2;
    if (op2.symbol === 'ImaginaryUnit') return op1;

    // c * (bi)
    if (op2.isNumberLiteral && op2.re === 0 && op2.im !== 0)
      return op1.mul(op2.im!);

    // (bi) * c
    if (op1.isNumberLiteral && op1.re === 0 && op1.im !== 0)
      return op2.mul(op1.im!);
  }

  if (expr.operator === 'Divide') {
    const denom = expr.op2;
    if (denom.isZero) return undefined;
    return getImaginaryFactor(expr.op1)?.div(denom);
  }

  return undefined;
}

export function normalizeFlags(flags: Partial<NumericFlags>): NumericFlags {
  const result = { ...flags };

  if (flags.zero || flags.one || flags.negativeOne) {
    result.zero = flags.zero && !flags.one && !flags.negativeOne;
    result.notZero = !flags.zero || flags.one || flags.negativeOne;
    result.one = flags.one && !flags.zero && !flags.negativeOne;
    result.negativeOne = flags.negativeOne && !flags.zero && !flags.one;
    result.infinity = false;
    result.NaN = false;
    result.finite = true;

    result.integer = true;
    result.finite = true;
    result.infinity = false;
    result.NaN = false;

    result.even = flags.one;
    result.odd = !flags.one;
  }

  if (result.zero) {
    result.positive = false;
    result.negative = false;
    result.nonPositive = true;
    result.nonNegative = true;
  }
  if (result.notZero === true) {
    if (!result.imaginary) result.real = true;
    result.zero = false;
  }
  if (result.one) {
    result.positive = true;
  }
  if (result.negativeOne) {
    result.nonPositive = true;
  }

  if (result.positive || result.nonNegative) {
    result.negativeOne = false;
  }
  if (result.positive) {
    result.nonPositive = false;
    result.negative = false;
    result.nonNegative = true;
  } else if (result.nonPositive) {
    result.positive = false;
    result.negative = result.notZero;
    result.nonNegative = !result.zero;
  } else if (result.negative) {
    result.positive = false;
    result.nonPositive = result.notZero;
    result.nonNegative = false;
  } else if (result.nonNegative) {
    result.positive = result.notZero;
    result.nonPositive = !result.zero;
    result.negative = false;
  }

  // Positive or negative numbers are real (not imaginary)
  if (
    result.positive ||
    result.negative ||
    result.nonPositive ||
    result.nonNegative
  ) {
    result.number = true;
    if (result.finite) result.real = true;
    // All non-imaginary numbers are complex
    else if (!result.finite) result.complex = true; // All non-imaginary numbers are complex

    result.imaginary = false;
  }

  if (result.finite) {
    result.number = true;
    result.complex = true;
    result.infinity = false;
    result.NaN = false;
  }

  if (result.infinity) {
    result.finite = false;
    result.NaN = false;
  }

  if (flags.even) result.odd = false;
  if (flags.odd) result.even = false;

  // Adjust domain flags
  if (result.integer) result.rational = true;
  if (result.real) result.complex = true;
  if (result.imaginary) result.complex = true;
  if (result.complex) result.number = true;

  return result as NumericFlags;
}
