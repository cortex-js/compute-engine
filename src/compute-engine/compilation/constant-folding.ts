/**
 * Constant folding utilities for GPU compilation.
 *
 * These helpers allow compilation handlers to detect compile-time constants,
 * fold numeric literals in code-string lists, and decompose complex
 * expressions into real/imaginary parts for direct vec2 construction.
 */

import type { Expression } from '../global-types';
import {
  isNumber,
  isFunction,
  isSymbol,
} from '../boxed-expression/type-guards';
import { BaseCompiler } from './base-compiler';

/**
 * Format a number as a GPU float literal, ensuring a decimal point.
 *
 * Examples: `5` → `"5.0"`, `3.14` → `"3.14"`, `-7` → `"-7.0"`.
 */
export function formatFloat(n: number): string {
  const str = n.toString();
  if (!str.includes('.') && !str.includes('e') && !str.includes('E')) {
    return `${str}.0`;
  }
  return str;
}

/**
 * Return a compile-time numeric constant if the expression is a finite real
 * number literal. Returns `undefined` for symbols, function expressions,
 * complex numbers, NaN, and Infinity.
 */
export function tryGetConstant(expr: Expression): number | undefined {
  if (!isNumber(expr)) return undefined;
  if (expr.im !== 0) return undefined;
  const re = expr.re;
  if (!isFinite(re)) return undefined;
  return re;
}

// Regex for a numeric literal in compiled code: optional minus, digits,
// optional decimal part.
const NUMERIC_LITERAL_RE = /^-?\d+(\.\d+)?$/;

/**
 * Combine compiled code strings with an operator, folding numeric literals
 * at compile time.
 *
 * For addition: accumulates numeric literals, eliminates `0.0` identity,
 * returns `"0.0"` for empty input.
 *
 * For multiplication: accumulates numeric literals, eliminates `1.0` identity,
 * short-circuits on `0.0` (absorbing element), returns `"1.0"` for empty input.
 */
export function foldTerms(
  terms: string[],
  identity: string,
  op: '+' | '*'
): string {
  const identityValue = op === '+' ? 0 : 1;
  let numericAcc: number | null = null;
  const symbolic: string[] = [];

  for (const term of terms) {
    if (NUMERIC_LITERAL_RE.test(term)) {
      const val = parseFloat(term);
      if (op === '*' && val === 0) return '0.0';
      if (numericAcc === null) {
        numericAcc = val;
      } else {
        numericAcc = op === '+' ? numericAcc + val : numericAcc * val;
      }
    } else {
      symbolic.push(term);
    }
  }

  // Prepend the numeric accumulator if it's not the identity value
  if (numericAcc !== null && numericAcc !== identityValue) {
    symbolic.unshift(formatFloat(numericAcc));
  }

  if (symbolic.length === 0) {
    // All terms were numeric (or empty input); return numeric result or identity
    if (numericAcc !== null) return formatFloat(numericAcc);
    return identity;
  }

  if (symbolic.length === 1) return symbolic[0];

  return symbolic.join(op === '+' ? ' + ' : ' * ');
}

/**
 * Decompose an expression into real and imaginary compiled code strings
 * for direct `vec2(re, im)` construction.
 *
 * Returns `null` if the expression cannot be decomposed (opaque complex
 * expression like `csin(z)`).
 *
 * Return shape:
 * - `{ re: null, im: "..." }` — zero real part
 * - `{ re: "...", im: null }` — zero imaginary part (purely real)
 * - `{ re: "...", im: "..." }` — both parts present
 *
 * @param expr    The expression to decompose
 * @param compile A function that compiles a sub-expression to target code
 */
export function tryGetComplexParts(
  expr: Expression,
  compile: (e: Expression) => string
): { re: string | null; im: string | null } | null {
  // ImaginaryUnit symbol → purely imaginary 1
  if (isSymbol(expr, 'ImaginaryUnit')) {
    return { re: null, im: '1.0' };
  }

  // Number literal with non-zero imaginary part → Complex literal
  if (isNumber(expr) && expr.im !== 0) {
    const re = expr.re;
    const im = expr.im;
    return {
      re: re !== 0 ? formatFloat(re) : null,
      im: formatFloat(im),
    };
  }

  // Multiply(..., imaginary_factor, ...) → factor out i
  // Recognizes both the ImaginaryUnit symbol and Complex(0, k) number literals
  if (isFunction(expr, 'Multiply')) {
    const ops = expr.ops;
    const iIndex = ops.findIndex(
      (op) =>
        isSymbol(op, 'ImaginaryUnit') ||
        (isNumber(op) && op.re === 0 && op.im !== 0)
    );
    if (iIndex >= 0) {
      const iFactor = ops[iIndex];
      // The imaginary scale: 1 for ImaginaryUnit, im for Complex(0, im)
      const iScale =
        isSymbol(iFactor, 'ImaginaryUnit') ? 1 : (iFactor as any).im;
      const remaining = ops.filter((_, idx) => idx !== iIndex);
      if (remaining.length === 0) {
        return { re: null, im: formatFloat(iScale) };
      }
      const compiledFactors = remaining.map((r) => compile(r));
      if (iScale !== 1)
        compiledFactors.unshift(formatFloat(iScale));
      const imCode = foldTerms(compiledFactors, '1.0', '*');
      return { re: null, im: imCode };
    }
  }

  // Opaque complex expression — cannot decompose into re/im parts.
  // Covers complex-valued function calls (e.g., csin(z)) and
  // complex-valued symbols (e.g., z declared as complex).
  if (BaseCompiler.isComplexValued(expr)) {
    return null;
  }

  // Symbol, number (real), or real-valued function → purely real
  return { re: compile(expr), im: null };
}
