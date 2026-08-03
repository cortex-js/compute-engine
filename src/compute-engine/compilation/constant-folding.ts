/**
 * Constant folding utilities for GPU compilation.
 *
 * These helpers allow compilation handlers to detect compile-time constants,
 * fold numeric literals in code-string lists, and decompose complex
 * expressions into real/imaginary parts for direct vec2 construction.
 */

import type { Expression } from '../global-types.js';
import {
  isNumber,
  isFunction,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { BaseCompiler } from './base-compiler.js';
import { asRational } from '../boxed-expression/numerics.js';
import { realPowerBranchTerms } from '../boxed-expression/arithmetic-power.js';
import { Complex } from 'complex-esm';

/**
 * The shader spelling of a NON-FINITE value (`NaN`, `±∞`).
 *
 * Neither GLSL nor WGSL has a `NaN` or an `Infinity` LITERAL — but both can
 * MAKE those values from a bit pattern, and the GPU target already routes the
 * masked (`When` / `Which` fall-through) NaN through exactly that mechanism
 * (`gpuNaN` in `gpu-target.ts`, which delegates here so there is exactly one
 * spelling). A non-finite CONSTANT is the same value reached by another route,
 * so it gets the same spelling instead of failing the compilation.
 *
 * GLSL goes through the overridable preamble helpers `_gpu_nan()` /
 * `_gpu_inf()` — one symbol a host can redefine without touching the generated
 * code. WGSL uses an inline `bitcast`, matching the existing WGSL NaN
 * convention (its spelling is pinned by `compile-wgsl.test.ts`).
 *
 * Infinity is a BIT PATTERN, never `1.0 / 0.0`: a fast-math driver is licensed
 * to fold a division by a constant zero (ANGLE→Metal fast-math already
 * destroys compensated arithmetic in this project), and a bit pattern is not
 * foldable.
 */
export function gpuNonFiniteLiteral(n: number, language?: string): string {
  const isWGSL = language === 'wgsl';
  if (Number.isNaN(n))
    return isWGSL ? 'bitcast<f32>(0x7fc00000u)' : '_gpu_nan()';
  const inf = isWGSL ? 'bitcast<f32>(0x7f800000u)' : '_gpu_inf()';
  return n > 0 ? inf : `(-${inf})`;
}

/**
 * Format a number as a GPU float literal, ensuring a decimal point.
 *
 * Examples: `5` → `"5.0"`, `3.14` → `"3.14"`, `-7` → `"-7.0"`.
 *
 * A non-finite value has no literal spelling in either shader language, so it
 * is emitted through `gpuNonFiniteLiteral` instead (which needs `language` to
 * pick the right form — pass it wherever the target is in scope).
 */
export function formatFloat(n: number, language?: string): string {
  if (!Number.isFinite(n)) return gpuNonFiniteLiteral(n, language);
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

/**
 * The REAL value of `base^expValue` for a NEGATIVE `base`, or `undefined` when
 * the principal branch is not real.
 *
 * `Math.pow` (and the shader `pow`) is NaN for every negative base with a
 * non-integer exponent, but that is narrower than CE's convention: an exponent
 * that is a rational `p/q` in lowest terms with an **odd** denominator has a
 * real principal root, so `(−8)^(2/3) = 4` — the same convention that makes
 * `Root(−8, 3) = −2`. Only an **even** denominator has no real value, and such
 * a node is typed `finite_complex` and lowers to the complex helper instead.
 *
 * Without this correction `Power(−8, 2/3)` compiled to `NaN` while the
 * interpreter returned `4` — a compiled/interpreted disagreement independent of
 * the type-driven complex lowering (the node stays `finite_number`).
 *
 * The real `q`-th root of a negative is negative, so the result is
 * `(−1)^p · |base|^(p/q)`.
 *
 * Returns `undefined` unless the real branch is PROVABLE, leaving the caller's
 * NaN fold in place. "Provable" is measured by `realPowerBranchTerms`, the same
 * helper the interpreter's numeric power uses — the branch must never be
 * decided differently here, or the compiled value contradicts `.N()`. It
 * prefers the exponent's EXACT rational (so `100/3` is recognized as an odd
 * denominator, where recovering `p/q` from the double lands on an even one) and
 * falls back to an ulp-tolerant float reconstruction, which is what the
 * interpreter is left with once `.N()` has numericized the exponent.
 */
export function negativeBaseRealPow(
  base: number,
  exp: Expression | null | undefined,
  expValue: number
): number | undefined {
  if (!(base < 0) || !Number.isFinite(base)) return undefined;
  if (!Number.isFinite(expValue) || Number.isInteger(expValue))
    return undefined;

  // The branch is decided by the exponent's EXACT rational when it has one,
  // and only otherwise by the (ulp-tolerant) float reconstruction — sharing
  // `realPowerBranchTerms` with the interpreter so the two can never disagree.
  const exact = exp ? asRational(exp) : undefined;
  const isExactRational = exact !== undefined;
  const terms = realPowerBranchTerms(exact, expValue);
  if (terms === undefined) return undefined;
  const [p, q] = terms;
  if (q % 2 === 0) return undefined;

  // The magnitude is |base|^(p/q), evaluated the way the INTERPRETER evaluates
  // this node — the two paths round differently and the fold must match
  // whichever one the uncompiled expression takes:
  //
  // - An exact rational of SMALL terms goes through the interpreter's exact
  //   arithmetic, which lands on clean values. Mirror it by taking the q-th
  //   ROOT first and then the p-th power: `Math.pow(8, 1/3)` is exactly `2`, so
  //   `(−8)^(2/3)` folds to exactly `4`, where a direct `Math.pow(8, 2/3)`
  //   leaves `3.9999999999999996`.
  // - Everything else — a float exponent, or an exact rational with terms too
  //   large for the root-then-power split to stay accurate — goes through the
  //   interpreter's float path. Match it with the DIRECT power: for a
  //   continued-fraction reconstruction like `√2 ≈ 54608393/38613965` the split
  //   compounds rounding over a huge `p` and drifts ~1e-9 off the interpreter,
  //   while the direct form agrees to the last ulp.
  const useSplit = isExactRational && Math.abs(p) <= 64 && q <= 64;
  let magnitude = useSplit
    ? Math.pow(Math.pow(-base, 1 / q), p)
    : Math.pow(-base, expValue);
  // A large `p` can overflow the split form where the direct one does not.
  if (!Number.isFinite(magnitude)) magnitude = Math.pow(-base, expValue);
  if (!Number.isFinite(magnitude)) return undefined;
  return p % 2 === 0 ? magnitude : -magnitude;
}

/**
 * The PRINCIPAL complex power of two real constants — the value a
 * `Power`/`Root` node typed `finite_complex` folds to, shared by every target
 * so they all fold the same constant.
 *
 * A HALF-INTEGER exponent over a negative base has an exactly pure-imaginary or
 * pure-real value (`(−100)^2.5 = 100000i`), but the polar `Complex.pow` leaves
 * real dust on the zero component (~3e-11 there) — the same reason
 * `complexSqrtLiteral` uses `Complex.sqrt` rather than `pow(x, 0.5)`. Compose
 * those from the exact `Complex.sqrt` and integer multiplication instead, so
 * the folded constant matches the interpreter digit for digit.
 */
export function principalComplexPow(
  base: number,
  exp: number
): { re: number; im: number } {
  const twice = exp * 2;
  if (Number.isInteger(twice) && twice !== 0 && Math.abs(twice) <= 64) {
    const root = new Complex(base, 0).sqrt();
    let acc = new Complex(1, 0);
    for (let i = 0; i < Math.abs(twice); i++) acc = acc.mul(root);
    if (twice < 0) acc = new Complex(1, 0).div(acc);
    if (Number.isFinite(acc.re) && Number.isFinite(acc.im))
      return { re: acc.re, im: acc.im };
  }
  const r = new Complex(base, 0).pow(new Complex(exp, 0));
  return { re: r.re, im: r.im };
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
  op: '+' | '*',
  language?: string
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
    symbolic.unshift(formatFloat(numericAcc, language));
  }

  if (symbolic.length === 0) {
    // All terms were numeric (or empty input); return numeric result or identity
    if (numericAcc !== null) return formatFloat(numericAcc, language);
    return identity;
  }

  if (symbolic.length === 1) return symbolic[0];

  return symbolic.join(op === '+' ? ' + ' : ' * ');
}

/**
 * Parenthesize a compiled operand for safe use as a multiplicative factor.
 *
 * `foldTerms(..., '*')` joins operand strings with ` * ` without adding
 * precedence parentheses. That is fine when operands come through the
 * operator path (which already wraps lower-precedence operands), but the
 * complex-multiply function handlers compile their operands with no
 * precedence context, so a top-level additive factor like `x + 1.0` would be
 * joined as `x + 1.0 * z` (mis-grouped). Wrap `Add`/`Subtract` operands so
 * they bind as a single factor.
 *
 * @param expr The source expression for the operand.
 * @param code The already-compiled operand code.
 */
export function parenthesizeFactor(expr: Expression, code: string): string {
  if (isFunction(expr, 'Add') || isFunction(expr, 'Subtract'))
    return `(${code})`;
  return code;
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
  compile: (e: Expression) => string,
  language?: string
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
      re: re !== 0 ? formatFloat(re, language) : null,
      im: formatFloat(im, language),
    };
  }

  // Multiply(..., imaginary_factor, ...) → factor out i
  // Recognizes both the ImaginaryUnit symbol and Complex(0, k) number literals
  if (isFunction(expr, 'Multiply')) {
    const ops = expr.ops;
    const iIndex = imaginaryFactorIndex(ops);
    if (iIndex >= 0) {
      const iFactor = ops[iIndex];
      // The imaginary scale: 1 for ImaginaryUnit, im for Complex(0, im)
      const iScale = isSymbol(iFactor, 'ImaginaryUnit')
        ? 1
        : (iFactor as any).im;
      const remaining = ops.filter((_, idx) => idx !== iIndex);
      if (remaining.length === 0) {
        return { re: null, im: formatFloat(iScale, language) };
      }
      const compiledFactors = remaining.map((r) =>
        parenthesizeFactor(r, compile(r))
      );
      if (iScale !== 1) compiledFactors.unshift(formatFloat(iScale, language));
      const imCode = foldTerms(compiledFactors, '1.0', '*', language);
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

/** The index of a factor standing for `i` (the `ImaginaryUnit` symbol or a
 * `Complex(0, k)` literal), or -1. */
function imaginaryFactorIndex(ops: ReadonlyArray<Expression>): number {
  return ops.findIndex(
    (op) =>
      isSymbol(op, 'ImaginaryUnit') ||
      (isNumber(op) && op.re === 0 && op.im !== 0)
  );
}

/**
 * Whether `tryGetComplexParts` would DECLINE (`null`) for `expr` — an opaque
 * complex operand (a complex-valued call or symbol) with no structural re/im
 * decomposition.
 *
 * Exposed so a caller can test for the decline BEFORE compiling anything:
 * `tryGetComplexParts` COMPILES each operand it decomposes, and a caller that
 * discards the whole decomposition as soon as ONE operand is opaque would
 * otherwise compile the others a second time. For an IMPURE (Random-family)
 * operand that is an extra evaluation — and on the GPU the discarded compile's
 * hoisted statement stays in the shader, an orphan consuming a draw that feeds
 * nothing.
 */
export function isOpaqueComplexOperand(expr: Expression): boolean {
  if (isSymbol(expr, 'ImaginaryUnit')) return false;
  if (isNumber(expr) && expr.im !== 0) return false;
  if (isFunction(expr, 'Multiply') && imaginaryFactorIndex(expr.ops) >= 0)
    return false;
  return BaseCompiler.isComplexValued(expr);
}
