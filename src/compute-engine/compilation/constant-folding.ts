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
import { chop, factorial, ROUNDOFF_TOLERANCE } from '../numerics/numeric.js';
import { gamma } from '../numerics/special-functions.js';
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
 * The shortest decimal spelling that a shader reads back as the same single
 * precision number.
 *
 * A shader float literal is rounded to IEEE single when the shader is
 * compiled, so every decimal digit past the ones single precision can tell
 * apart is noise. `Number.prototype.toString` gives the shortest spelling that
 * round-trips through a DOUBLE, which for a value single precision produced —
 * `Math.fround(2π)` — is the exact binary value written out in full:
 * `6.2831854820251465`, seventeen digits for a number with about seven
 * significant ones. This walks the precisions from one digit upward and stops
 * at the first spelling that `Math.fround` reads back as the same single, so
 * `Math.fround(2π)` prints as `6.2831855`. Nine significant digits always
 * round-trip a single, so the walk always terminates.
 *
 * Three values are left to `toString`. One too large for single precision
 * would round to an infinity that no decimal literal spells. An
 * INTEGER-valued one keeps every digit it has, because an integer literal is
 * what a loop bound, an array length and the argument of an `int()`/`i32()`
 * conversion are made of: WGSL evaluates an unsuffixed float literal in a
 * const expression at abstract-float precision, which is at least single and
 * may be double, so moving `16777217.0` to its single-precision neighbour
 * `16777216.0` could move such a bound by one where every value context reads
 * both as the same single. One too small to survive rounding to single
 * precision underflows to zero: `Math.fround(1e-300)` is `0`, and the
 * shortest-decimal search below would then hand back the candidate `"0"`,
 * silently losing the value, so a non-zero `n` that underflows to zero is
 * also left to `toString`.
 */
function shortestFloat32Decimal(n: number): string {
  if (Number.isInteger(n)) return n.toString();
  const single = Math.fround(n);
  if (!Number.isFinite(single)) return n.toString();
  if (single === 0 && n !== 0) return n.toString();
  for (let digits = 1; digits <= 9; digits++) {
    const candidate = Number(single.toPrecision(digits));
    if (Math.fround(candidate) === single) return candidate.toString();
  }
  return single.toString();
}

/**
 * Format a number as a GPU float literal, ensuring a decimal point.
 *
 * Examples: `5` → `"5.0"`, `3.14` → `"3.14"`, `-7` → `"-7.0"`.
 *
 * The digits are the shortest that read back as the same single precision
 * value (`shortestFloat32Decimal`), which is all a shader can hold.
 *
 * A non-finite value has no literal spelling in either shader language, so it
 * is emitted through `gpuNonFiniteLiteral` instead (which needs `language` to
 * pick the right form — pass it wherever the target is in scope).
 */
export function formatFloat(n: number, language?: string): string {
  if (!Number.isFinite(n)) return gpuNonFiniteLiteral(n, language);
  const str = shortestFloat32Decimal(n);
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
 * a node is typed `complex` and lowers to the complex helper instead.
 *
 * Without this correction `Power(−8, 2/3)` compiled to `NaN` while the
 * interpreter returned `4` — a compiled/interpreted disagreement independent of
 * the type-driven complex lowering (the node stays `number`).
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
 * `Power`/`Root` node typed `complex` folds to, shared by every target
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
 * operator path (which already wraps lower-precedence operands), but a
 * top-level additive factor like `x + 1.0` would be joined as `x + 1.0 * z`
 * (mis-grouped). Wrap `Add`/`Subtract` operands so they bind as a single
 * factor.
 *
 * Used by `tryGetComplexParts` below, which is handed a bare
 * `(e: Expression) => string` compiler and so has no precedence channel to
 * push the enclosing binding power down. Testing the two additive heads is
 * exhaustive for its operands: the only other infix heads that bind looser
 * than `*` on any target are the relational and logical ones, and a
 * boolean-valued factor of a product is an `incompatible-type` error at box
 * time, so it never reaches an emitter; a conditional (`If`) emits an
 * already-parenthesized ternary. A caller that DOES hold the target should
 * compile the factor at the `*` precedence instead and let the shared
 * compiler place the parentheses (see `gpuMultiplicativeFactor` in
 * `gpu-target.ts`).
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

// ---------------------------------------------------------------------------
// Emitted-code constant folding
//
// The folds above run on the EXPRESSION tree, before anything is emitted. Some
// literal arithmetic is created by the emission itself and is out of their
// reach: a `Sum`/`Product` with literal bounds is unrolled by substituting the
// index at the VARIABLE level (`target.var`), so the tree is never rewritten
// and the emitted terms carry `(1 + -0.5)`, `0.025 * (1 + -0.5)` and
// `-Math.sqrt(-_SYS.pow2(0.025 * (1 + -0.5)) + 1) + 1` — one such term per
// unrolled step. The folder below reads the emitted CODE instead and replaces
// a closed literal expression with the literal it computes. (The Tycho
// code-generation audit of 2026-09-08 measured a 35.9 KB JavaScript preamble
// and 80 such sites for one 20-term sum.)
// ---------------------------------------------------------------------------

/**
 * How one target's emitted code is read, evaluated and re-spelled by
 * `foldEmittedCode`.
 *
 * The fold is a source-to-source transformation of the TARGET language: it
 * evaluates exactly the operations the emitted code names, with the same
 * rounding and in the same order, so the folded literal is the value that code
 * would have computed at run time. It is therefore independent of what
 * expression produced the code — a caller-supplied lowering folds as
 * faithfully as a built-in one. The one thing it must assume is that an
 * allowlisted NAME still means what the target's own emission means by it: a
 * caller who maps an operator onto a routine spelled `sqrt` and supplies a
 * different implementation would have that call folded with the IEEE square
 * root. Every other spelling declines by construction.
 */
interface EmittedFoldDialect {
  /** Names that stand for a numeric constant (`Math.PI`). An exact spelling:
   * a name that is not listed is a variable, a temporary or a caller-spliced
   * source, and it stops the fold. */
  readonly constants: Readonly<Record<string, number>>;
  /** Names that may be CALLED, each with the value it computes from its
   * arguments. An entry answers `undefined` for an argument list its routine
   * does not take. Deterministic routines only: `Math.random` and any other
   * impure or drawing routine must keep running at run time. */
  readonly calls: Readonly<
    Record<string, (args: readonly number[]) => number | undefined>
  >;
  /** The rounding of ONE arithmetic step. The identity on a target whose
   * arithmetic is IEEE double (JavaScript); `Math.fround` on a shader target,
   * whose arithmetic is IEEE single — a double operation rounded once to
   * single is the correctly rounded single result for `+`, `-`, `*`, `/` and
   * `sqrt`, so folding this way is bit-identical to the shader. */
  readonly round: (x: number) => number;
  /** Whether `%` is an operator of the language. JavaScript's `%` on doubles
   * is exact (the remainder after a truncated division), so it folds like any
   * other operator. Neither shader language has it. */
  readonly remainder: boolean;
  /** Whether a numeric literal must carry a decimal point or an exponent to be
   * read as a number. Set on the shader targets: every float literal they emit
   * is spelled with a point (`formatFloat`), so a BARE integer literal marks
   * an integer context — a loop bound, an index, a conversion argument — where
   * re-emitting a float literal would not even be the same type. */
  readonly decimalPointRequired: boolean;
  /** The literal spelling of a folded value, parenthesized when the caller
   * asks. */
  readonly literal: (value: number, parenthesize: boolean) => string;
  /** Names that may be called on ONE complex argument, each with the complex
   * value it computes. Present only on a target whose complex values have a
   * literal spelling this fold can write back (`complexLiteral`); a shader
   * target carries a complex value in a `vec2`, which the reader has no value
   * for, so it lists none. */
  readonly complexCalls?: Readonly<
    Record<string, (re: number, im: number) => { re: number; im: number }>
  >;
  /** The literal spelling of a folded complex value. */
  readonly complexLiteral?: (re: number, im: number) => string;
  /** Memo by code string: the same constant subtree recurs across the unrolled
   * terms of a sum, and the fold is called on every emitted function node.
   * `null` records a decline. Cleared wholesale at `EMITTED_FOLD_MEMO_LIMIT`
   * entries. */
  readonly memo: Map<string, string | null>;
}

/** Entries kept in a dialect's fold memo before it is cleared. */
const EMITTED_FOLD_MEMO_LIMIT = 4096;

/** A decimal numeric literal, anchored at the scan position. */
const EMITTED_NUMBER = /(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;

/** A dotted name (`Math.PI`, `_SYS.pow2`, `sqrt`), anchored at the scan
 * position. Read whole: a reader that matched only `Math.` would admit
 * `Math.random`. */
const EMITTED_NAME = /[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*/y;

/**
 * A recursive-descent reader over emitted code, evaluating the part of the
 * target language that is closed arithmetic on literals: numeric literals,
 * parentheses, unary `-`/`+`, the binary operators of `EmittedFoldDialect`,
 * and the allowlisted constant names and calls. Anything else — an identifier
 * that is not allowlisted, `?:`, a comparison, a string, `_.x`, `_cse1`, `x` —
 * makes the reader answer `undefined` and leave its position where the last
 * complete operand ended, which is what lets a caller fold a PREFIX of a
 * chain.
 *
 * No `new Function`: the grammar is small, and evaluating emitted code through
 * the JavaScript engine would run whatever a caller spliced into it.
 */
class EmittedCodeReader {
  /** The scan position: after a successful parse, one past the last character
   * consumed; after a failed one, back where that parse started. */
  pos = 0;

  /** Whether the consumed text APPLIES something — an operator or a call —
   * rather than merely naming a value. A lone literal or constant is already
   * the cheapest spelling of what it denotes, and re-spelling it is pure
   * churn: on a shader target it would also replace the source literal by its
   * single-precision expansion (`0.025` → `0.02500000037252903`), which is the
   * same float32 value written at eight times the length. */
  applied = false;

  constructor(
    private readonly code: string,
    private readonly dialect: EmittedFoldDialect
  ) {}

  private skipWhitespace(): void {
    while (this.pos < this.code.length) {
      const c = this.code[this.pos];
      if (c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') return;
      this.pos += 1;
    }
  }

  /** Whether nothing but whitespace remains. */
  atEnd(): boolean {
    this.skipWhitespace();
    return this.pos >= this.code.length;
  }

  private number(): number | undefined {
    EMITTED_NUMBER.lastIndex = this.pos;
    const match = EMITTED_NUMBER.exec(this.code);
    if (match === null) return undefined;
    const text = match[0];
    const next = this.code[this.pos + text.length];
    // A literal that continues into a letter, a digit, a second point or an
    // identifier character is not a decimal double: `0x7f800000u` (a shader
    // bit pattern), `1f` (a WGSL suffix), `2.0f`. `parseFloat` reads a PREFIX
    // of such text and answers a different value.
    if (next !== undefined && /[A-Za-z0-9_$.]/.test(next)) return undefined;
    if (this.dialect.decimalPointRequired && !/[.eE]/.test(text))
      return undefined;
    this.pos += text.length;
    // Round the literal itself: on a shader target the source literal is read
    // as a single, so `0.025` is not the double `0.025`.
    return this.dialect.round(parseFloat(text));
  }

  /** Undo a parse that failed part way: an abandoned branch must leave
   * neither its position nor its `applied` mark behind, or a later fold reads
   * an application that is not in the text it consumed. */
  private backtrack(pos: number, applied: boolean): undefined {
    this.pos = pos;
    this.applied = applied;
    return undefined;
  }

  private call(name: string): number | undefined {
    const start = this.pos;
    const applied = this.applied;
    this.pos += name.length;
    this.skipWhitespace();
    if (this.code[this.pos] !== '(') return this.backtrack(start, applied);
    this.pos += 1;
    const args: number[] = [];
    this.skipWhitespace();
    if (this.code[this.pos] === ')') this.pos += 1;
    else {
      for (;;) {
        const arg = this.additive();
        if (arg === undefined) return this.backtrack(start, applied);
        args.push(arg);
        this.skipWhitespace();
        const c = this.code[this.pos];
        this.pos += 1;
        if (c === ',') continue;
        if (c === ')') break;
        return this.backtrack(start, applied);
      }
    }
    const value = this.dialect.calls[name](args);
    if (value === undefined) return this.backtrack(start, applied);
    this.applied = true;
    return value;
  }

  private primary(): number | undefined {
    this.skipWhitespace();
    const start = this.pos;
    const applied = this.applied;
    if (this.code[this.pos] === '(') {
      this.pos += 1;
      const value = this.additive();
      if (value !== undefined) {
        this.skipWhitespace();
        if (this.code[this.pos] === ')') {
          this.pos += 1;
          return value;
        }
      }
      return this.backtrack(start, applied);
    }
    const literal = this.number();
    if (literal !== undefined) return literal;
    EMITTED_NAME.lastIndex = this.pos;
    const match = EMITTED_NAME.exec(this.code);
    if (match === null) return undefined;
    const name = match[0];
    if (Object.hasOwn(this.dialect.calls, name)) return this.call(name);
    if (Object.hasOwn(this.dialect.constants, name)) {
      this.pos += name.length;
      return this.dialect.constants[name];
    }
    return undefined;
  }

  private unary(): number | undefined {
    this.skipWhitespace();
    const c = this.code[this.pos];
    if (c !== '-' && c !== '+') return this.primary();
    const start = this.pos;
    const applied = this.applied;
    this.pos += 1;
    const operand = this.unary();
    if (operand === undefined) return this.backtrack(start, applied);
    // Negation is exact in both IEEE formats, so there is no rounding step.
    return c === '-' ? -operand : operand;
  }

  /** A `*` / `/` / `%` chain, folded left to right — the association the
   * emitted code itself has, so each step sees the operands it would see at
   * run time. */
  multiplicative(): number | undefined {
    let value = this.unary();
    if (value === undefined) return undefined;
    for (;;) {
      const end = this.pos;
      const applied = this.applied;
      this.skipWhitespace();
      const op = this.code[this.pos];
      const isOperator =
        op === '*' || op === '/' || (op === '%' && this.dialect.remainder);
      // `**` is exponentiation, which binds TIGHTER than multiplication: the
      // operand before it belongs to the power, not to this chain.
      if (!isOperator || (op === '*' && this.code[this.pos + 1] === '*')) {
        this.backtrack(end, applied);
        return value;
      }
      this.pos += 1;
      const rhs = this.unary();
      if (rhs === undefined) {
        this.backtrack(end, applied);
        return value;
      }
      value = this.dialect.round(
        op === '*' ? value * rhs : op === '/' ? value / rhs : value % rhs
      );
      this.applied = true;
    }
  }

  /** A `+` / `-` chain over multiplicative operands, folded left to right. */
  additive(): number | undefined {
    let value = this.multiplicative();
    if (value === undefined) return undefined;
    for (;;) {
      const end = this.pos;
      const applied = this.applied;
      this.skipWhitespace();
      const op = this.code[this.pos];
      if (op !== '+' && op !== '-') {
        this.backtrack(end, applied);
        return value;
      }
      this.pos += 1;
      const rhs = this.multiplicative();
      if (rhs === undefined) {
        this.backtrack(end, applied);
        return value;
      }
      value = this.dialect.round(op === '+' ? value + rhs : value - rhs);
      this.applied = true;
    }
  }

  /** One named component of an emitted complex literal: `re: <expression>`.
   * The key is matched exactly — an object with any other key is not the
   * complex value this reader knows. */
  private component(key: 're' | 'im'): number | undefined {
    const start = this.pos;
    const applied = this.applied;
    this.skipWhitespace();
    EMITTED_NAME.lastIndex = this.pos;
    const match = EMITTED_NAME.exec(this.code);
    if (match === null || match[0] !== key)
      return this.backtrack(start, applied);
    this.pos += key.length;
    this.skipWhitespace();
    if (this.code[this.pos] !== ':') return this.backtrack(start, applied);
    this.pos += 1;
    const value = this.additive();
    if (value === undefined) return this.backtrack(start, applied);
    return value;
  }

  /**
   * The value of an emitted COMPLEX operand.
   *
   * The JavaScript target writes a complex value as `({ re: <re>, im: <im> })`,
   * always with the two keys in that order and always in that shape
   * (`complexOperandCode`), so the reader accepts exactly it — with the
   * enclosing parentheses optional, since a caller may hand over a group whose
   * parentheses it has already stripped. A REAL expression stands for the same
   * value with a zero imaginary part, which is how a real operand reaches a
   * complex routine.
   */
  complexOperand(): { re: number; im: number } | undefined {
    this.skipWhitespace();
    const start = this.pos;
    const applied = this.applied;
    const parenthesized = this.code[this.pos] === '(';
    if (parenthesized) {
      this.pos += 1;
      this.skipWhitespace();
    }
    if (this.code[this.pos] !== '{') {
      // Not an object literal: read the whole operand as a real expression,
      // from the position the parenthesis test started at.
      this.backtrack(start, applied);
      const real = this.additive();
      if (real === undefined) return this.backtrack(start, applied);
      return { re: real, im: 0 };
    }
    this.pos += 1;
    const re = this.component('re');
    if (re === undefined) return this.backtrack(start, applied);
    this.skipWhitespace();
    if (this.code[this.pos] !== ',') return this.backtrack(start, applied);
    this.pos += 1;
    const im = this.component('im');
    if (im === undefined) return this.backtrack(start, applied);
    this.skipWhitespace();
    if (this.code[this.pos] !== '}') return this.backtrack(start, applied);
    this.pos += 1;
    if (parenthesized) {
      this.skipWhitespace();
      if (this.code[this.pos] !== ')') return this.backtrack(start, applied);
      this.pos += 1;
    }
    return { re, im };
  }
}

/**
 * The characters an emitted expression may be FOLLOWED by for a folded prefix
 * to keep its meaning: the binary operators, and the punctuation that closes
 * an operand. A `.`, a `(`, a `[` or an identifier character would bind to the
 * literal spliced in (`(1 + 2).toFixed` must not become `3.toFixed`), and `**`
 * binds tighter than the multiplication the prefix was folded over.
 */
const EMITTED_SAFE_FOLLOWER = /^[-+*/%<>=!&|^?:,)\]};]/;

/**
 * Fold the literal arithmetic in one emitted code string, or `undefined` when
 * there is nothing to fold or the code is not closed.
 *
 * Three folds, in order:
 *
 * 1. The WHOLE code, when it is a closed literal expression:
 *    `-Math.sqrt(-_SYS.pow2(0.025 * (1 + -0.5)) + 1) + 1` becomes one literal.
 * 2. Failing that, the LEADING run of a multiplicative chain: `2 * Math.PI *
 *    _.s` becomes `6.283185307179586 * _.s`. The run is a prefix of the
 *    expression and folds in the source's own left-to-right order, so every
 *    operation and every rounding is one the code already had — which is also
 *    why the run may not be extended across a non-literal operand. A chain
 *    whose FIRST operand is not literal folds nothing: turning
 *    `_.s * 2 * Math.PI` into `_.s * 6.283…` would multiply in a different
 *    order and round differently.
 * 3. Failing both, the BODY of a redundant outer parenthesis pair, re-wrapped
 *    in the same parentheses. A prefix run that the emitter enclosed —
 *    `(2 * Math.PI * _.s)`, the numerator a quotient parenthesizes — is
 *    invisible to fold 2, because the reader needs the whole group to close
 *    before it can use it as one operand. Folding the body and putting the
 *    parentheses back leaves the group in exactly the place, and with exactly
 *    the associativity, the emitter gave it.
 *
 * A non-finite result declines: `1 / 0` keeps its structural code, whose pole
 * semantics the target chose deliberately. Code that APPLIES nothing declines
 * too (see `EmittedCodeReader.applied`) — a lone literal or named constant is
 * already the cheapest spelling of its value.
 */
function foldEmittedCode(
  code: string,
  dialect: EmittedFoldDialect,
  splices: readonly string[]
): string | undefined {
  let folded = dialect.memo.get(code);
  if (folded === undefined) {
    folded = evaluateEmittedCode(code, dialect) ?? null;
    if (dialect.memo.size >= EMITTED_FOLD_MEMO_LIMIT) dialect.memo.clear();
    dialect.memo.set(code, folded);
  }
  // The memo is keyed by code alone; the caller's splices are a property of
  // the compilation, so they are checked outside it.
  if (folded === null) return undefined;
  return preservesMappedSplices(code, folded, splices) ? folded : undefined;
}

function evaluateEmittedCode(
  code: string,
  dialect: EmittedFoldDialect
): string | undefined {
  const whole = new EmittedCodeReader(code, dialect);
  const value = whole.additive();
  if (value !== undefined && whole.atEnd())
    return whole.applied ? emitFolded(value, code, '', dialect) : undefined;

  const prefix = new EmittedCodeReader(code, dialect);
  const head = prefix.multiplicative();
  if (head !== undefined && prefix.applied) {
    const consumed = code.slice(0, prefix.pos);
    const rest = code.slice(prefix.pos);
    const follower = rest.trimStart();
    if (
      EMITTED_SAFE_FOLLOWER.test(follower) &&
      !follower.startsWith('**') &&
      !follower.startsWith('?.')
    )
      return emitFolded(head, consumed, rest, dialect);
  }

  const complex = foldComplexCall(code, dialect);
  if (complex !== undefined) return complex;

  const body = parenthesizedBody(code);
  if (body === undefined) return undefined;
  const foldedBody = evaluateEmittedCode(body, dialect);
  return foldedBody === undefined ? undefined : `(${foldedBody})`;
}

/**
 * Fold a call of ONE of the dialect's complex routines on a literal complex
 * argument — `_SYS.csqrt(({ re: (-2), im: 0 }))` becomes the complex literal
 * `({ re: 0, im: 1.4142135623730951 })`.
 *
 * Such a call is created by the emission and is out of reach of the tree-level
 * folds for the same reason the numeric ones are: an unrolled `Sum` substitutes
 * its index into the emitted code, so `√(k−3)` at `k = 1` is a complex square
 * root of a constant that the tree never held.
 *
 * The whole code must be the call and nothing else — a fold of a PREFIX has no
 * meaning here, because a complex literal is not an operand of any arithmetic
 * this reader evaluates.
 */
function foldComplexCall(
  code: string,
  dialect: EmittedFoldDialect
): string | undefined {
  const { complexCalls, complexLiteral } = dialect;
  if (complexCalls === undefined || complexLiteral === undefined)
    return undefined;
  const text = code.trim();
  const open = text.indexOf('(');
  if (open < 0 || !text.endsWith(')')) return undefined;
  const name = text.slice(0, open);
  if (!Object.hasOwn(complexCalls, name)) return undefined;
  const reader = new EmittedCodeReader(text.slice(open + 1, -1), dialect);
  const arg = reader.complexOperand();
  if (arg === undefined || !reader.atEnd()) return undefined;
  const value = complexCalls[name](arg.re, arg.im);
  // A component the literal cannot spell (a NaN or an infinity) leaves the
  // call to run time, exactly as a non-finite real result does.
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im))
    return undefined;
  return complexLiteral(value.re, value.im);
}

/**
 * The text between a redundant outer parenthesis pair — the whole code is one
 * parenthesized group — or `undefined` when it is not of that shape.
 *
 * The scan counts parentheses, which is only a reliable reading of the code
 * when no parenthesis can be part of something else. Emitted code that
 * contains a QUOTE may hold one inside a string literal, so any quote
 * character declines the whole reading rather than risk cutting a group at the
 * wrong place. That is the same conservatism the reader itself has: it knows
 * no string grammar.
 */
function parenthesizedBody(code: string): string | undefined {
  const text = code.trim();
  if (!text.startsWith('(') || !text.endsWith(')')) return undefined;
  if (/['"`]/.test(text)) return undefined;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth += 1;
    else if (text[i] === ')') {
      depth -= 1;
      // The opening parenthesis closes before the end, so the code is not one
      // group (`(a) * (b)`).
      if (depth === 0 && i !== text.length - 1) return undefined;
    }
  }
  return depth === 0 ? text.slice(1, -1) : undefined;
}

/** The folded `value` spelled for `dialect`, followed by the unfolded `rest`.
 * Declines when the folded text repeats what `consumed` already said. */
function emitFolded(
  value: number,
  consumed: string,
  rest: string,
  dialect: EmittedFoldDialect
): string | undefined {
  if (!Number.isFinite(value)) return undefined;
  // A NEGATIVE literal spliced where the code did not already begin with a
  // minus sign keeps parentheses: the parent chose its parentheses for the
  // unfolded code, and a bare leading `-` can glue to a preceding operator
  // (`a - -3`) or bind unexpectedly under a tighter one.
  const negative = value < 0 || Object.is(value, -0);
  const text = dialect.literal(
    value,
    negative && !consumed.trimStart().startsWith('-')
  );
  if (text === consumed.trim()) return undefined;
  return text + rest;
}

/** `String(-0)` is `"0"`, which loses a sign that a division or an `atan2`
 * reads. */
function javascriptNumberLiteral(value: number, parenthesize: boolean): string {
  const text = Object.is(value, -0) ? '-0' : String(value);
  return parenthesize ? `(${text})` : text;
}

/** Shader float literals always carry a decimal point (`formatFloat`), and
 * `formatFloat(-0)` would spell it `0.0`. */
function gpuNumberLiteral(value: number, parenthesize: boolean): string {
  const text = Object.is(value, -0) ? `-${formatFloat(0)}` : formatFloat(value);
  return parenthesize ? `(${text})` : text;
}

/** A routine of one argument. */
function unaryFold(
  fn: (x: number) => number
): (args: readonly number[]) => number | undefined {
  return (args) => (args.length === 1 ? fn(args[0]) : undefined);
}

/** A routine of two arguments. */
function binaryFold(
  fn: (x: number, y: number) => number
): (args: readonly number[]) => number | undefined {
  return (args) => (args.length === 2 ? fn(args[0], args[1]) : undefined);
}

/** A routine of one or more arguments (`Math.min`, `Math.max`,
 * `Math.hypot`). */
function variadicFold(
  fn: (...args: number[]) => number
): (args: readonly number[]) => number | undefined {
  return (args) => (args.length >= 1 ? fn(...args) : undefined);
}

/**
 * The `_SYS` complex routines whose body is one `complex-esm` method followed
 * by the kernel-roundoff chop (`toRI` in `javascript-target.ts`), listed as
 * `<runtime name>: <method>`.
 *
 * Every entry here is evaluated by calling that same method and applying that
 * same chop, so a folded literal is what the run-time call returns, digit for
 * digit. The routines with a hand-written body — `csign`, `clog10`, `clog2`,
 * `cinvhav`, the ring operations `cneg` and `cconj` — are deliberately absent:
 * each would need its own transcription, and a transcription that drifts from
 * the runtime is a compiled value that contradicts the interpreter.
 */
const JAVASCRIPT_COMPLEX_METHODS: Readonly<Record<string, ComplexUnaryMethod>> =
  {
    '_SYS.csin': 'sin',
    '_SYS.ccos': 'cos',
    '_SYS.ctan': 'tan',
    '_SYS.casin': 'asin',
    '_SYS.cacos': 'acos',
    '_SYS.catan': 'atan',
    '_SYS.csinh': 'sinh',
    '_SYS.ccosh': 'cosh',
    '_SYS.ctanh': 'tanh',
    '_SYS.csqrt': 'sqrt',
    '_SYS.cexp': 'exp',
    '_SYS.cln': 'log',
    '_SYS.ccot': 'cot',
    '_SYS.csec': 'sec',
    '_SYS.ccsc': 'csc',
    '_SYS.ccoth': 'coth',
    '_SYS.csech': 'sech',
    '_SYS.ccsch': 'csch',
    '_SYS.cacot': 'acot',
    '_SYS.casec': 'asec',
    '_SYS.cacsc': 'acsc',
    '_SYS.cacoth': 'acoth',
    '_SYS.casech': 'asech',
    '_SYS.cacsch': 'acsch',
    '_SYS.cacosh': 'acosh',
    '_SYS.catanh': 'atanh',
  };

/** A `complex-esm` method that takes no argument and answers a `Complex`. */
type ComplexUnaryMethod = {
  [K in keyof Complex]: Complex[K] extends () => Complex ? K : never;
}[keyof Complex];

const JAVASCRIPT_COMPLEX_CALLS: Readonly<
  Record<string, (re: number, im: number) => { re: number; im: number }>
> = Object.fromEntries(
  Object.entries(JAVASCRIPT_COMPLEX_METHODS).map(([name, method]) => [
    name,
    (re: number, im: number) => {
      const r = new Complex(re, im)[method]();
      return {
        re: chop(r.re, ROUNDOFF_TOLERANCE),
        im: chop(r.im, ROUNDOFF_TOLERANCE),
      };
    },
  ])
);

/** The JavaScript spelling of a complex value: the same `({ re: …, im: … })`
 * object the target's own emission writes, so a folded literal stands exactly
 * where the call it replaces stood. */
function javascriptComplexLiteral(re: number, im: number): string {
  return (
    `({ re: ${javascriptNumberLiteral(re, false)}, ` +
    `im: ${javascriptNumberLiteral(im, false)} })`
  );
}

/**
 * The JavaScript emitted-code dialect.
 *
 * The constants and routines are the ones this target's own lowerings emit
 * (`JAVASCRIPT_CONSTANTS`, `JAVASCRIPT_FUNCTIONS` and the `_SYS` runtime
 * object), all deterministic and all evaluated here in IEEE double — the same
 * arithmetic the emitted code runs. `Math.random` and the rest of the `Math`
 * object are deliberately absent: an admitted name has to be deterministic BY
 * NAME, because a caller's `vars` spelling is spliced into the code verbatim.
 *
 * `_SYS.pow2` and `_SYS.pow3` fold as the products their runtime definitions
 * compute (`x * x`, `x * x * x`), not through `Math.pow`.
 */
const JAVASCRIPT_EMITTED_FOLD: EmittedFoldDialect = {
  constants: {
    'Math.PI': Math.PI,
    'Math.E': Math.E,
    'Math.LN2': Math.LN2,
    'Math.LN10': Math.LN10,
    'Math.LOG2E': Math.LOG2E,
    'Math.LOG10E': Math.LOG10E,
    'Math.SQRT2': Math.SQRT2,
    'Math.SQRT1_2': Math.SQRT1_2,
  },
  calls: {
    'Math.sqrt': unaryFold(Math.sqrt),
    'Math.cbrt': unaryFold(Math.cbrt),
    'Math.abs': unaryFold(Math.abs),
    'Math.floor': unaryFold(Math.floor),
    'Math.ceil': unaryFold(Math.ceil),
    'Math.round': unaryFold(Math.round),
    'Math.trunc': unaryFold(Math.trunc),
    'Math.sign': unaryFold(Math.sign),
    'Math.sin': unaryFold(Math.sin),
    'Math.cos': unaryFold(Math.cos),
    'Math.tan': unaryFold(Math.tan),
    'Math.asin': unaryFold(Math.asin),
    'Math.acos': unaryFold(Math.acos),
    'Math.atan': unaryFold(Math.atan),
    'Math.atan2': binaryFold(Math.atan2),
    'Math.sinh': unaryFold(Math.sinh),
    'Math.cosh': unaryFold(Math.cosh),
    'Math.tanh': unaryFold(Math.tanh),
    'Math.asinh': unaryFold(Math.asinh),
    'Math.acosh': unaryFold(Math.acosh),
    'Math.atanh': unaryFold(Math.atanh),
    'Math.exp': unaryFold(Math.exp),
    'Math.expm1': unaryFold(Math.expm1),
    'Math.log': unaryFold(Math.log),
    'Math.log1p': unaryFold(Math.log1p),
    'Math.log2': unaryFold(Math.log2),
    'Math.log10': unaryFold(Math.log10),
    'Math.pow': binaryFold(Math.pow),
    'Math.hypot': variadicFold(Math.hypot),
    'Math.min': variadicFold(Math.min),
    'Math.max': variadicFold(Math.max),
    '_SYS.pow2': unaryFold((x) => x * x),
    '_SYS.pow3': unaryFold((x) => x * x * x),
    '_SYS.pow4': unaryFold((x) => {
      const s = x * x;
      return s * s;
    }),
    '_SYS.pow5': unaryFold((x) => {
      const s = x * x;
      return s * s * x;
    }),
    // `_SYS.pow` is `Math.pow` with the interpreter's `0^0 = NaN` convention.
    // It is the lowering of every power whose EXPONENT is not a literal in the
    // tree, which is exactly what a `Sum` or `Product` index is: the unroll
    // substitutes the index value into the emitted code afterwards, so
    // `(-1)^k` reaches this fold as `_SYS.pow(-1, 1)`. A `0^0` gives NaN,
    // which the non-finite guard refuses, so that call is left to run time
    // and still answers the NaN the interpreter answers.
    '_SYS.pow': binaryFold((base, exp) =>
      base === 0 && exp === 0 ? NaN : Math.pow(base, exp)
    ),
    // `x! = Γ(x+1)` and Γ itself, spelling a POLE as `Infinity` — the float
    // projection of the interpreter's `~oo` — exactly as the two runtime
    // routines do. Both call the same shared helpers the runtime calls, so the
    // folded literal cannot drift from the value the call would return, and a
    // pole is non-finite and therefore declines.
    '_SYS.factorial': unaryFold((x) =>
      Number.isInteger(x) ? (x < 0 ? Infinity : factorial(x)) : gamma(x + 1)
    ),
    '_SYS.gamma': unaryFold((z) =>
      Number.isInteger(z) && z <= 0 ? Infinity : gamma(z)
    ),
  },
  round: (x) => x,
  remainder: true,
  decimalPointRequired: false,
  literal: javascriptNumberLiteral,
  complexCalls: JAVASCRIPT_COMPLEX_CALLS,
  complexLiteral: javascriptComplexLiteral,
  memo: new Map<string, string | null>(),
};

/**
 * The largest absolute INTEGER exponent a shader `pow` call folds at.
 *
 * It is the same bound the GPU target puts on inlining an integer power as
 * repeated multiplication (`GPU_POWI_INLINE_LIMIT` in `gpu-target.ts`, also 8),
 * and for the same reason: inside that range the target's own lowering of an
 * integer power over a LITERAL base — which is the only base this fold ever
 * sees — is a chain of multiplications written left to right, so folding that
 * way reproduces the code the target would have written. Past it the
 * target routes through the `_gpu_powi` preamble helper, whose arm for a large
 * exponent is the hardware `pow` — a value this compiler cannot predict. The
 * constant is repeated here rather than imported because `gpu-target.ts`
 * imports this module, and the reverse import would close a cycle.
 */
const GPU_POW_FOLD_LIMIT = 8;

/**
 * `base^exponent` in shader arithmetic for an INTEGER exponent: repeated
 * single-precision multiplication, left to right, which is what the GPU target
 * emits for a literal integer power. `undefined` for anything else.
 */
function gpuIntegerPow(base: number, exponent: number): number | undefined {
  if (!Number.isInteger(exponent)) return undefined;
  const n = Math.abs(exponent);
  if (n > GPU_POW_FOLD_LIMIT) return undefined;
  // `0^0` is the one case the GPU target deliberately leaves to the hardware
  // (it has no NaN literal to spell the interpreter's indeterminate `0^0`
  // with), so the fold does not decide it either.
  if (base === 0 && exponent === 0) return undefined;
  let value = 1;
  for (let i = 0; i < n; i++) value = Math.fround(value * base);
  return exponent < 0 ? Math.fround(1 / value) : value;
}

/**
 * `_gpu_powi(x, n)` as the preamble helper computes it, for the exponents whose
 * value the helper makes predictable. `undefined` for every other exponent.
 *
 * The helper unrolls only `n` of 0, 2, 3 and 4 into single-precision products.
 * Every other exponent — `|n| ≥ 5` and ALL negative ones — reaches the hardware
 * `pow(abs(x), n)` with the sign restored afterwards, and a shader `pow` is not
 * correctly rounded: its value is the driver's, not one this compiler may
 * predict, so those decline. The single exception is `n = 1`: raising the
 * magnitude to the first power leaves it unchanged and the odd-exponent branch
 * then restores the sign, so the helper answers `x` itself.
 *
 * This is deliberately NOT `gpuIntegerPow`, the fold for a plain `pow` call:
 * that one reproduces the left-to-right chain of products the GPU target emits
 * for a LITERAL integer exponent, which is a different lowering from the
 * helper's — the helper computes `n = 4` as `(x·x)·(x·x)` and has no product
 * chain at all past `n = 4`.
 */
function gpuPowiHelper(base: number, exponent: number): number | undefined {
  if (!Number.isInteger(exponent)) return undefined;
  if (exponent === 0) return 1;
  if (exponent === 1) return base;
  if (exponent === 2) return Math.fround(base * base);
  if (exponent === 3) return Math.fround(Math.fround(base * base) * base);
  if (exponent === 4) {
    const s = Math.fround(base * base);
    return Math.fround(s * s);
  }
  return undefined;
}

/**
 * The GLSL / WGSL emitted-code dialect.
 *
 * Every step rounds to single (`Math.fround`), so a folded literal is
 * bit-identical to what the shader computes. Only `sqrt`, `pow` at an integer
 * exponent and the fixed-power helpers are admitted: `+`, `-`, `*`, `/` and
 * `sqrt` are correctly rounded in IEEE single, so a double computation rounded
 * once reproduces them exactly, while a shader `sin`, `cos`, `exp` or a
 * fractional `pow` is NOT correctly rounded and its value is the driver's, not
 * one this compiler may predict. There are no constants: neither shader
 * language has a named numeric constant, so a bare name in shader code is
 * always a variable, a uniform or a helper.
 *
 * `pow` at an INTEGER exponent is admitted for a different reason than the
 * correctly-rounded operations, and it fixes a wrong VALUE rather than a cost.
 * Both shader languages define `pow(x, y)` as `exp2(y·log2(x))`, which is
 * undefined for a negative `x` — `pow(-1.0, 1.0)` answers NaN on most drivers,
 * so a kernel alternating signs with `(-1)^k` computes the wrong thing. The GPU
 * target already refuses to write `pow` for a literal integer exponent for
 * exactly that reason (it emits repeated multiplication or `_gpu_powi`); such a
 * call only reaches the emitted code when the exponent became a literal AFTER
 * the tree was compiled, which is what a `Sum` unroll does when it substitutes
 * its index. Folding by repeated multiplication is therefore the value the
 * target's own lowering would have produced, not the driver's.
 *
 * `_gpu_pow2` and `_gpu_pow3` fold as the products the preamble helpers
 * compute (`x * x`, `x * x * x`), each product rounded like the shader's, and
 * `_gpu_powi` folds at the exponents its own helper body turns into such
 * products (`gpuPowiHelper`), declining the ones that reach a hardware `pow`
 * inside the helper. The
 * per-width vector overloads (`_gpu_pow2_v2`) are absent on purpose: their
 * argument is a vector, which this reader has no value for. `abs` is exact in
 * every IEEE format (it only clears the sign bit), so it folds too; without
 * it a radicand written as `abs(literal)` blocked the `sqrt` fold around it.
 */
const GPU_EMITTED_FOLD: EmittedFoldDialect = {
  constants: {},
  calls: {
    sqrt: unaryFold((x) => Math.fround(Math.sqrt(x))),
    abs: unaryFold((x) => Math.abs(x)),
    pow: (args) =>
      args.length === 2 ? gpuIntegerPow(args[0], args[1]) : undefined,
    // The sign-preserving integer power the target emits for a run-time
    // exponent of integer TYPE; after a `Sum` unroll substitutes its index the
    // exponent is a literal. Only the exponents the helper computes as
    // single-precision products fold — see `gpuPowiHelper`, which mirrors the
    // helper body rather than the plain `pow` lowering. A non-integer literal
    // exponent cannot arrive here (the emitter gates the helper on the
    // exponent's type) and declines anyway.
    _gpu_powi: (args) =>
      args.length === 2 ? gpuPowiHelper(args[0], args[1]) : undefined,
    _gpu_pow2: unaryFold((x) => Math.fround(x * x)),
    _gpu_pow3: unaryFold((x) => Math.fround(Math.fround(x * x) * x)),
  },
  round: Math.fround,
  remainder: false,
  decimalPointRequired: true,
  literal: gpuNumberLiteral,
  memo: new Map<string, string | null>(),
};

/**
 * The SOURCE each `vars`-mapped symbol is spliced into the emitted code as.
 *
 * A mapped symbol is the caller's live binding: the `vars` contract says it is
 * never folded, and the emitted-code folds honour that by leaving each splice
 * where it stands (`preservesMappedSplices`). A caller who maps `u` to
 * `'Math.PI/4'` keeps `Math.sin(6 * Math.PI/4)` in the code — arithmetic the
 * fold could otherwise evaluate, since the splice is spelled entirely in the
 * dialect's own grammar.
 *
 * Collected once, when the target is built. `resolve` is the target's `var`
 * hook, which answers a mapped key from the caller's map before it records
 * anything, so reading it here has no effect on the compilation.
 *
 * A splice that is a bare numeric literal is left out: a NON-string `vars`
 * value is a constant the caller asked to BAKE, so folding through it is what
 * the caller wanted, and protecting the literal would stop every fold whose
 * code merely contains that digit.
 */
export function callerSpliceSources(
  keys: ReadonlySet<string> | undefined,
  resolve: ((id: string) => string | undefined) | undefined
): string[] {
  if (keys === undefined || resolve === undefined) return [];
  const sources: string[] = [];
  for (const key of keys) {
    const source = resolve(key);
    if (typeof source !== 'string' || source.length === 0) continue;
    if (Number.isFinite(Number(source))) continue;
    sources.push(source);
  }
  return sources;
}

/** Occurrences of `needle` in `text`, counted without overlap. */
function countOccurrences(text: string, needle: string): number {
  let count = 0;
  for (
    let at = text.indexOf(needle);
    at >= 0;
    at = text.indexOf(needle, at + needle.length)
  )
    count += 1;
  return count;
}

/**
 * Whether `folded` still spells every caller splice as often as `code` did.
 *
 * This is what keeps the fold inside the `vars` contract: a fold that merely
 * stands NEXT to a splice is fine (`2 * Math.PI * _.s` → `6.283185307179586 *
 * _.s` leaves `_.s` untouched), while one that would consume it is refused.
 */
export function preservesMappedSplices(
  code: string,
  folded: string,
  splices: readonly string[]
): boolean {
  for (const splice of splices)
    if (countOccurrences(code, splice) > countOccurrences(folded, splice))
      return false;
  return true;
}

/**
 * Fold the literal arithmetic in a JavaScript emission
 * (`CompileTarget.foldEmittedConstant` on the JavaScript target). `splices`
 * are the caller's `vars` sources, which the fold leaves in place — see
 * `callerSpliceSources`.
 */
export function foldEmittedJavaScriptCode(
  code: string,
  splices: readonly string[] = []
): string | undefined {
  return foldEmittedCode(code, JAVASCRIPT_EMITTED_FOLD, splices);
}

/**
 * Fold the literal arithmetic in a GLSL or WGSL emission
 * (`CompileTarget.foldEmittedConstant` on the shader targets). The two
 * languages share one dialect: they agree on the spelling of a float literal,
 * on `sqrt`, and on the fixed-power helper names the GPU target declares.
 */
export function foldEmittedGPUCode(
  code: string,
  splices: readonly string[] = []
): string | undefined {
  return foldEmittedCode(code, GPU_EMITTED_FOLD, splices);
}
