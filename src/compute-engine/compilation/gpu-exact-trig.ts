/**
 * The exact sine hash of the GLSL target, and the warning of the shader
 * targets for a trigonometric value amplified in float32.
 *
 * A shader computes in float32, about 7 significant digits. In the "sine
 * hash" that shaders use as a random number generator,
 * `fract(43758.5453 · sin(12.9898 · x))` or `fract(10^4 · sin(10^4 · x))`, a
 * large constant factor amplifies the rounding of the argument (inside the
 * sine) or of the sine itself (outside it) until the fractional part has no
 * relation to its exact value. The `javascript` target computes the same
 * expression in float64, so the two targets draw different pictures.
 *
 * An operand of `Mod` or `Fract` is flagged (`isAmplifiedTrig`) when a
 * constant of magnitude ≥ 1000 multiplies a trigonometric call (a factor of a
 * `Multiply` on the way from the operand to the call, or a divisor of
 * magnitude ≤ 10⁻³), or multiplies something inside the call's argument. For
 * `Mod(u, 1)` and `Fract(u)` with `u = O·sin(Σ Kᵢ·xᵢ + c)` (or `cos`, and the
 * sum may be a `Dot` of a vector with a list of numbers), the GLSL target
 * emits an exact form when `|O| ≤ 5·10^4` and every `xᵢ` is a value whose
 * float32 form is exact (`exactOperand`). Every other flagged operand, and
 * every flagged operand on WGSL, compiles to the usual float32 code with a
 * warning of kind `'correctness'` and code `'float32-unsafe-argument'` on
 * `CompilationResult.warnings`, so that the caller can compute it on the CPU
 * when the value matters (a curve) and keep the shader when it does not (a
 * noise texture). An operand that contains a function the caller maps to its
 * own code (the `functions` option of `compile()`) is left alone.
 *
 * The exact form (`GPU_EXACT_TRIG_PREAMBLE_GLSL`) is float64-equivalent
 * arithmetic built from float32:
 *  - each product `K·x` is exact as `p + e`: `e` comes from the 48-bit product
 *    of the two significands, formed with `uint` arithmetic on the float bits
 *    (`floatBitsToUint`), which a shader compiler cannot reorder;
 *  - each constant is two float32 parts, `K = Khi + Klo`, so that the value
 *    matches the float64 constant of the `javascript` target;
 *  - the angle is reduced by π/2 with `k` split into two 12-bit halves and π/2
 *    into 12-bit parts, so that every product `k·Cᵢ` is exact. The first
 *    subtraction, `p − k·C1`, is exact (the two are within a factor 2), and
 *    every later one keeps its rounding in a low part (two-sum). The error
 *    terms of the products, as large as 1 when `|K·x|` nears the limit, are
 *    added to the angle with a two-sum only once it is small: added to the
 *    low part, each would be rounded by about 6·10⁻⁸, which the outer factor
 *    amplifies past 10⁻³;
 *  - `sin` and `cos` are Taylor polynomials on [−π/4, π/4], with the leading
 *    terms added exactly, so the sine is a pair `hi + lo` with `|lo|` below
 *    one unit in the last place of `hi` (the final two-sum keeps the pair
 *    normalized, which the fractional part below relies on);
 *  - the outer product `O·s` is exact again before `fract`.
 * The reduction is exact while `|K·x| ≤ 2.6·10^7` (`k < 2^24`). The bound of
 * each operand also keeps the error of the two-part constant (`K − Khi − Klo`,
 * amplified by `O·x`) below 10⁻⁴, and an integer-valued operand below the
 * range where float32 holds it exactly. Beyond its bound the shader returns
 * NaN, and the compile result lists each operand with its bound
 * (`CompilationResult.float32Bounds`). The `compileFunction` and
 * `compileShader` routes emit the same code but return a string, so they
 * report neither the bounds nor the warnings.
 *
 * Every declaration in the helpers is `highp`: a host that keeps the GLSL ES
 * fragment default (`mediump int`) would otherwise run the bit arithmetic in
 * as few as 16 bits.
 *
 * The shader compiler (measured: ANGLE on Metal) reorders float arithmetic:
 * it rewrites `(a + b) − a` as `b`, fuses a product into the next subtraction
 * and expands `fract(p) + e` as `(p + e) − floor(p)`. Each value an exact step
 * depends on therefore passes through `_gpu_opq`, which XORs its bits with a
 * uniform whose value is 0: the compiler cannot know that value, so it cannot
 * rewrite the arithmetic around it. GLSL ES 3.00 initializes a uniform to 0
 * at link time, so the host sets nothing. A multiplication by a uniform 1.0
 * was not enough for the two-sum.
 *
 * Measured on 2026-10-18 on an Apple M5 Max (ANGLE on Metal) and on
 * SwiftShader, at 4,096 inputs each: the three shapes match the float64 value
 * within 10⁻³ at every input (the plain float32 code missed at 3,960 to
 * 4,090), at about 7× the cost of the plain code (10× for a `Dot` of three
 * terms). See the ROADMAP entry for Tycho ledger rows 382 and 384.
 */

import type { Expression } from '../global-types.js';
import type { CompileDiagnostic, CompileTarget } from './types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';
import { BigDecimal } from '../../big-decimal/index.js';
import { BaseCompiler } from './base-compiler.js';
import { formatFloat } from './constant-folding.js';

/**
 * The heads an exact constant term may use. Each one evaluates exactly and
 * has no side effect.
 */
const GPU_EXACT_ARITHMETIC_HEADS = new Set([
  'Add',
  'Subtract',
  'Negate',
  'Multiply',
  'Divide',
  'Rational',
  'Power',
  'Sqrt',
  'Root',
]);

/**
 * Whether `op` is a real number literal or an exact-arithmetic expression over
 * real number literals. An exponent above 4096 is refused, so that the exact
 * evaluation stays cheap (`2^{10^6}` has 300 000 digits).
 */
function gpuIsExactArithmetic(op: Expression): boolean {
  if (isNumber(op)) return !op.isComplex && op.isFinite === true;
  if (!isFunction(op) || !GPU_EXACT_ARITHMETIC_HEADS.has(op.operator))
    return false;
  if (op.operator === 'Power') {
    const e = op.ops[1];
    if (e === undefined || !isNumber(e) || !(Math.abs(e.re) <= 4096))
      return false;
  }
  return op.ops.every(gpuIsExactArithmetic);
}

/**
 * The exact real value of a constant term, as a number literal: a real number
 * literal, or an exact-arithmetic expression over real number literals
 * (`10^{20}`, `10^7/3`, `10^6·√2`). A term that calls any other function is
 * not a constant term, even with no symbols: `Random()` must be drawn at run
 * time, and a caller may map a function to its own code (the `functions`
 * option of `compile()`).
 */
export function gpuExactConstant(op: Expression): Expression | undefined {
  if (!gpuIsExactArithmetic(op)) return undefined;
  const v = isNumber(op) ? op : op.evaluate();
  return isNumber(v) && !v.isComplex && v.isFinite === true ? v : undefined;
}

/** The value of a number literal as a `BigDecimal`, at the current precision. */
export function gpuBigValue(op: Expression): BigDecimal | undefined {
  if (!isNumber(op)) return undefined;
  const v = op.numericValue;
  const b = typeof v === 'number' ? new BigDecimal(v) : v.bignumRe;
  return b !== undefined && b.isFinite() ? b : undefined;
}

/**
 * Call `fn` with the exact sum `c = Σ literals + π·Σ piFactors`, computed with
 * `BigDecimal` at a precision that keeps every digit of `c` and 30 more, and
 * return its result. `undefined` when the sum is not finite or has more than
 * 10 000 digits; a zero sum is passed to `fn` like any other.
 *
 * The constant is first added at 50 digits to read its magnitude; `fn` then
 * runs at the precision that magnitude needs, so that the integer part of
 * `c/P` for any period `P` is exact. `BigDecimal.precision` is global, so it
 * is restored afterwards.
 */
export function gpuWithExactConstant<T>(
  literals: ReadonlyArray<Expression>,
  piFactors: ReadonlyArray<Expression>,
  fn: (c: BigDecimal) => T | undefined
): T | undefined {
  const constant = (): BigDecimal | undefined => {
    let c = BigDecimal.ZERO;
    for (const op of literals) {
      const v = gpuBigValue(op);
      if (v === undefined) return undefined;
      c = c.add(v);
    }
    if (piFactors.length > 0) {
      let k = BigDecimal.ZERO;
      for (const op of piFactors) {
        const v = gpuBigValue(op);
        if (v === undefined) return undefined;
        k = k.add(v);
      }
      c = c.add(k.mul(BigDecimal.PI));
    }
    return c;
  };
  const savedPrecision = BigDecimal.precision;
  try {
    BigDecimal.precision = 50;
    const rough = constant();
    if (rough === undefined) return undefined;
    if (rough.isZero()) return fn(rough);
    const significand =
      rough.significand < 0n ? -rough.significand : rough.significand;
    const digits = rough.exponent + significand.toString().length;
    if (digits > 10000) return undefined;
    BigDecimal.precision = Math.max(50, digits + 30);
    const c = constant();
    return c === undefined ? undefined : fn(c);
  } finally {
    BigDecimal.precision = savedPrecision;
  }
}

/**
 * The largest `|K·x|` the exact reduction handles: `k = round(K·x · 2/π)`
 * must be below 2^24, so that it is an exact float32 integer and its two
 * 12-bit halves are exact. `2^24·π/2 ≈ 2.635·10^7`; the limit keeps a margin.
 */
export const GPU_EXACT_TRIG_LIMIT = 2.6e7;

/**
 * The largest outer factor `|O|` of the exact form. The two-part sine is
 * within about 1.3·10⁻⁸ of the exact sine (measured), and `O` multiplies that
 * error: at `|O| = 5·10^4` it is 6.5·10⁻⁴, with 10⁻⁴ more kept for the
 * two-part constants. The corpus hashes use 10^4 and 43758.5453.
 */
const GPU_EXACT_TRIG_MAX_OUTER = 5e4;

/**
 * The share of the 10⁻³ error budget left to the residual of a two-part
 * constant: `|K − Khi − Klo|·|x|·|O|` stays below it inside the bound.
 */
const GPU_EXACT_TRIG_CONSTANT_BUDGET = 1e-4;

/**
 * The GLSL helpers of the exact sine hash, in dependency order (GLSL requires
 * a declaration before its use). `gpuLibrarySubset` keeps the definitions a
 * compilation names; the `uniform` line belongs to `_gpu_opq`, the first
 * definition that reads it. Every declaration is `highp`.
 *
 * π/2 is split into 12-bit parts computed from 60 digits of π/2:
 * 1.5703125, 4.8375129699707031e-4, 7.5495336204767227e-8,
 * 2.5632829192545614e-12 and 6.1230317691118863e-17.
 *
 * `_gpu_xred(x, khi, klo, xmax)` reduces `K·x` and marks it in range when
 * `|x| ≤ xmax`, the bound the compile result reports for `x`.
 */
export const GPU_EXACT_TRIG_PREAMBLE_GLSL = `
uniform highp uint _gpu_zero_u;
highp float _gpu_opq(highp float v) {
  return uintBitsToFloat(floatBitsToUint(v) ^ _gpu_zero_u);
}

highp vec2 _gpu_two_sum(highp float fa, highp float fb) {
  highp float a = _gpu_opq(fa);
  highp float b = _gpu_opq(fb);
  highp float s = _gpu_opq(a + b);
  highp float bb = _gpu_opq(s - a);
  return vec2(s, _gpu_opq(a - _gpu_opq(s - bb)) + _gpu_opq(b - bb));
}

highp vec2 _gpu_two_prod(highp float fa, highp float fb) {
  highp float a = _gpu_opq(fa);
  highp float b = _gpu_opq(fb);
  highp float p = _gpu_opq(a * b);
  highp uint ua = floatBitsToUint(a);
  highp uint ub = floatBitsToUint(b);
  if (!(abs(p) >= 1e-30 && abs(p) <= 1e30) || (ua & 0x7F800000u) == 0u || (ub & 0x7F800000u) == 0u) return vec2(p, 0.0);
  highp uint up = floatBitsToUint(p);
  highp uint ma = (ua & 0x7FFFFFu) | 0x800000u;
  highp uint mb = (ub & 0x7FFFFFu) | 0x800000u;
  highp uint mp = (up & 0x7FFFFFu) | 0x800000u;
  highp int sc = int((ua >> 23) & 0xFFu) + int((ub >> 23) & 0xFFu) - 300;
  highp int s = int((up >> 23) & 0xFFu) - 150 - sc;
  highp uint a1 = ma >> 12;
  highp uint a0 = ma & 0xFFFu;
  highp uint b1 = mb >> 12;
  highp uint b0 = mb & 0xFFFu;
  highp uint lo = a0 * b0 + ((a1 * b0 + a0 * b1) << 12) + ((a1 * b1) << 24);
  highp uint d = lo - (mp << uint(s));
  highp int r = (d & 0x80000000u) != 0u ? -int(~d + 1u) : int(d);
  highp float sgn = ((ua ^ ub) & 0x80000000u) != 0u ? -1.0 : 1.0;
  highp int h = sc / 2;
  return vec2(p, sgn * float(r) * uintBitsToFloat(uint(h + 127) << 23) * uintBitsToFloat(uint(sc - h + 127) << 23));
}

highp vec4 _gpu_xred_fix(highp vec4 a) {
  highp float r = a.x;
  highp float lo = a.y;
  highp float k = floor(_gpu_opq((r + lo) * 0.636619772) + 0.5);
  highp vec2 t = _gpu_two_sum(r, -(k * 1.5703125));
  r = t.x;
  lo += t.y;
  t = _gpu_two_sum(r, -(k * 4.8375129699707031e-4));
  r = t.x;
  lo += t.y;
  lo -= k * 7.5495336204767227e-8 + k * 2.5632829192545614e-12;
  highp float q = a.z + k;
  return vec4(r, lo, q - 4.0 * floor(q / 4.0), a.w);
}

highp vec4 _gpu_xred(highp float x, highp float khi, highp float klo, highp float xmax) {
  highp vec2 pe = _gpu_two_prod(x, khi);
  highp vec2 qe = _gpu_two_prod(x, klo);
  highp float p = pe.x;
  highp float k = floor(_gpu_opq(p * 0.636619772) + 0.5);
  highp float kh = floor(k / 4096.0);
  highp float kl = k - kh * 4096.0;
  highp vec2 s = _gpu_two_sum((kh * 1.5703125) * 4096.0, kl * 1.5703125);
  highp float r = _gpu_opq(p - s.x);
  highp vec2 t = _gpu_two_sum(r, -(kh * 4.8375129699707031e-4) * 4096.0);
  r = t.x;
  highp float lo = t.y;
  t = _gpu_two_sum(r, -(kl * 4.8375129699707031e-4));
  r = t.x;
  lo += t.y;
  t = _gpu_two_sum(r, -(kh * 7.5495336204767227e-8) * 4096.0);
  r = t.x;
  lo += t.y;
  t = _gpu_two_sum(r, -(kl * 7.5495336204767227e-8));
  r = t.x;
  lo += t.y;
  lo -= k * 2.5632829192545614e-12 + k * 6.1230317691118863e-17;
  t = _gpu_two_sum(r, -s.y);
  r = t.x;
  lo += t.y;
  t = _gpu_two_sum(r, pe.y);
  r = t.x;
  lo += t.y;
  t = _gpu_two_sum(r, qe.x);
  r = t.x;
  lo += t.y + qe.y;
  return _gpu_xred_fix(vec4(r, lo, k, abs(x) <= xmax ? 1.0 : 0.0));
}

highp vec4 _gpu_xred_add(highp vec4 a, highp vec4 b) {
  highp vec2 s = _gpu_two_sum(a.x, b.x);
  return _gpu_xred_fix(vec4(s.x, a.y + b.y + s.y, a.z + b.z, a.w * b.w));
}

highp vec2 _gpu_xsin(highp vec4 a) {
  highp vec2 rr = _gpu_two_sum(a.x, a.y);
  highp float rh = rr.x;
  highp float rl = rr.y;
  highp float r2 = rh * rh;
  highp float ts = (rh * r2) * (-0.166666667 + r2 * (8.33333333e-3 + r2 * (-1.98412698e-4 + r2 * 2.75573192e-6)));
  highp vec2 sn = _gpu_two_sum(rh, (rl - 0.5 * rl * r2) + ts);
  highp vec2 p2 = _gpu_two_prod(rh, rh);
  highp float tc = (p2.x * p2.x) * (4.16666667e-2 + p2.x * (-1.38888889e-3 + p2.x * (2.48015873e-5 + p2.x * -2.75573192e-7)));
  highp vec2 c1 = _gpu_two_sum(1.0, -0.5 * p2.x);
  highp vec2 cs = _gpu_two_sum(c1.x, c1.y + (-0.5 * (p2.y + 2.0 * rh * rl) + tc));
  if (a.z == 0.0) return sn;
  if (a.z == 1.0) return cs;
  if (a.z == 2.0) return -sn;
  return -cs;
}

highp float _gpu_xfract(highp vec2 s, highp float ohi, highp float olo, highp float ok) {
  highp float sx = _gpu_opq(s.x);
  highp float sy = _gpu_opq(s.y);
  highp vec2 pe = _gpu_two_prod(sx, ohi);
  highp vec2 a = _gpu_two_sum(pe.x, -floor(pe.x));
  highp float small = a.y + (pe.y + sy * ohi + sx * olo);
  highp float h = _gpu_opq(a.x + small);
  if (h >= 1.0) {
    highp float d = _gpu_opq(a.x - 1.0) + small;
    h = d >= 0.0 ? d : 0.99999994;
  }
  if (h < 0.0) {
    h = _gpu_opq(h + 1.0);
    if (h >= 1.0) h = 0.99999994;
  }
  return ok > 0.5 ? h : uintBitsToFloat(0x7FC00000u);
}

highp float _gpu_xhash_sin(highp vec4 a, highp float ohi, highp float olo) {
  return _gpu_xfract(_gpu_xsin(a), ohi, olo, a.w);
}

highp float _gpu_xhash_cos(highp vec4 a, highp float ohi, highp float olo) {
  highp float q = a.z + 1.0;
  return _gpu_xfract(_gpu_xsin(vec4(a.x, a.y, q - 4.0 * floor(q / 4.0), a.w)), ohi, olo, a.w);
}
`;

/**
 * The bound of one operand of an exact sine hash: the compiled value is exact
 * while `|operand| ≤ maxAbs`, and NaN beyond it. `operand` is the operand as
 * `toString()` writes it (`x`, `At(p, 2)`, `Floor(x) + 1`), which needs no
 * LaTeX syntax.
 */
export type Float32Bound = { operand: string; maxAbs: number };

/**
 * What one compilation recorded, keyed by its naming context: a shared object
 * of the compilation that every nested target carries by reference
 * (`CompileTarget.naming`). Each record keeps the text it emitted, so that a
 * record whose code was later thrown away (a user-function definition that is
 * removed, a call folded to a constant, a candidate the CSE pass drops) is
 * left out of the result (`gpuExactTrigReport`).
 */
type GpuExactTrigRecords = {
  bounds: Array<{ bound: Float32Bound; text: string }>;
  warnings: Array<{ warning: CompileDiagnostic; text: string }>;
};
const GPU_EXACT_TRIG_RECORDS = new WeakMap<object, GpuExactTrigRecords>();

function records(
  target: CompileTarget<Expression>
): GpuExactTrigRecords | undefined {
  const key = target.naming;
  if (key === undefined) return undefined;
  let r = GPU_EXACT_TRIG_RECORDS.get(key);
  if (r === undefined) {
    r = { bounds: [], warnings: [] };
    GPU_EXACT_TRIG_RECORDS.set(key, r);
  }
  return r;
}

/**
 * The bounds and warnings recorded by the compilation `target` belongs to,
 * for the code it emitted: `emitted` is the final code with its preamble.
 * A bound appears once per operand and value; a warning once per operand.
 */
export function gpuExactTrigReport(
  target: CompileTarget<Expression>,
  emitted: string
): { bounds: Float32Bound[]; warnings: CompileDiagnostic[] } {
  const r =
    target.naming === undefined
      ? undefined
      : GPU_EXACT_TRIG_RECORDS.get(target.naming);
  const bounds: Float32Bound[] = [];
  const warnings: CompileDiagnostic[] = [];
  if (r === undefined) return { bounds, warnings };
  for (const { bound, text } of r.bounds)
    if (
      emitted.includes(text) &&
      !bounds.some(
        (b) => b.operand === bound.operand && b.maxAbs === bound.maxAbs
      )
    )
      bounds.push({ ...bound });
  for (const { warning, text } of r.warnings)
    if (
      emitted.includes(text) &&
      !warnings.some(
        (w) => w.code === warning.code && w.value === warning.value
      )
    )
      warnings.push({ ...warning });
  return { bounds, warnings };
}

const TRIG_HEADS = new Set(['Sin', 'Cos', 'Tan', 'Cot', 'Sec', 'Csc']);

/** The real value of a constant expression, or `undefined`. */
function constantValue(e: Expression): number | undefined {
  const c = gpuExactConstant(e);
  return c === undefined ? undefined : c.re;
}

/**
 * Whether `e` contains, anywhere, a `Multiply` with a constant factor of
 * magnitude ≥ 1000, a `Divide` by a constant of magnitude ≤ 10⁻³, or a `Dot`
 * with a list of numbers one of which has magnitude ≥ 1000.
 */
function hasLargeFactor(e: Expression): boolean {
  if (!isFunction(e)) return false;
  const large = (op: Expression): boolean => {
    const c = constantValue(op);
    return c !== undefined && Math.abs(c) >= 1000;
  };
  if (e.operator === 'Multiply' && e.ops.some(large)) return true;
  if (e.operator === 'Divide') {
    const d = e.ops[1] === undefined ? undefined : constantValue(e.ops[1]);
    if (d !== undefined && d !== 0 && Math.abs(d) <= 1e-3) return true;
  }
  if (
    e.operator === 'Dot' &&
    e.ops.some(
      (op) =>
        (isFunction(op, 'List') || isFunction(op, 'Tuple')) &&
        op.ops.some(large)
    )
  )
    return true;
  return e.ops.some(hasLargeFactor);
}

/**
 * Whether the float32 value of the `Mod` or `Fract` operand `u` can have no
 * relation to its exact value: a trigonometric call whose argument has a
 * large factor (`hasLargeFactor`), or a trigonometric call that a large
 * factor multiplies on the way from `u` to the call (through `Multiply`,
 * `Negate`, `Add`, `Subtract`, `Abs` and the numerator of `Divide`). A large
 * constant in a term that does not hold the call (`Mod(1000x + sin y, 1)`),
 * or behind another function (`Floor(1000 sin x)`), is not flagged.
 */
function isAmplifiedTrig(u: Expression): boolean {
  // `onChain`: `e` is reached from `u` through `Multiply`, `Negate`, `Add`,
  // `Subtract`, `Abs` and numerators only, so a large factor met here
  // multiplies whatever trigonometric value lies below it. `amplified`: such
  // a factor was met.
  const walk = (
    e: Expression,
    onChain: boolean,
    amplified: boolean
  ): boolean => {
    if (!isFunction(e)) return false;
    if (TRIG_HEADS.has(e.operator))
      return (
        amplified ||
        e.ops.some(hasLargeFactor) ||
        e.ops.some((op) => walk(op, false, false))
      );
    if (!onChain) return e.ops.some((op) => walk(op, false, false));
    switch (e.operator) {
      case 'Multiply': {
        const large = e.ops.some((op) => {
          const c = constantValue(op);
          return c !== undefined && Math.abs(c) >= 1000;
        });
        return e.ops.some((op) => walk(op, true, amplified || large));
      }
      case 'Divide': {
        const d = e.ops[1] === undefined ? undefined : constantValue(e.ops[1]);
        const small = d !== undefined && d !== 0 && Math.abs(d) <= 1e-3;
        return (
          walk(e.ops[0], true, amplified || small) ||
          (e.ops[1] !== undefined && walk(e.ops[1], false, false))
        );
      }
      case 'Negate':
      case 'Add':
      case 'Subtract':
      case 'Abs':
        return e.ops.some((op) => walk(op, true, amplified));
      default:
        return e.ops.some((op) => walk(op, false, false));
    }
  };
  return walk(u, true, false);
}

/** Whether `e` mentions an operator the caller maps to its own code. */
function mentionsOverride(
  e: Expression,
  overridden: ReadonlySet<string> | undefined
): boolean {
  if (overridden === undefined || overridden.size === 0) return false;
  if (!isFunction(e)) return false;
  return (
    overridden.has(e.operator) ||
    e.ops.some((op) => mentionsOverride(op, overridden))
  );
}

/**
 * Whether the symbol `x` is a run-time input of the compiled code: a name the
 * `vars` option maps, or a symbol that is not bound at this site (not a
 * function parameter, a `Block` local, a loop index or a comprehension
 * variable) and has no value (a symbol with a value is written into the code
 * as its literal, rounded to float32).
 */
function isFreeInput(
  x: Expression,
  target: CompileTarget<Expression>
): boolean {
  if (!isSymbol(x)) return false;
  if (target.varsKeys?.has(x.symbol) === true) return true;
  if (target.boundVars?.has(x.symbol) === true) return false;
  return x.value === undefined;
}

/**
 * The largest magnitude for which the float32 value of `x` is exact, or
 * `undefined` when it is not known to be exact.
 *
 * - A free input symbol (`isFreeInput`): the shader receives it as a float32
 *   value, which is its value. No limit.
 * - An integer-valued expression: an integer literal, a symbol typed
 *   `integer` (a loop index), `Floor`, `Ceil`, `Round` or `Truncate` of an
 *   exact operand (`Floor(x)`, but not `Floor(10x)`, where `10x` is rounded
 *   first), and `Add`, `Subtract`, `Negate` and `Multiply` of these. Exact
 *   below 2^24. A sum may also hold literals that are multiples of 1/256
 *   (the half of `Floor(x) + 0.5`): exact below 2^16.
 *
 * A bound `|x| ≤ limit` also bounds the intermediate values of a sum only
 * when they do not cancel; a cancelling sum of large integers is outside this
 * rule.
 */
function exactOperand(
  x: Expression,
  target: CompileTarget<Expression>
): number | undefined {
  if (isSymbol(x)) {
    if (x.type.matches('integer')) return 2 ** 24;
    return isFreeInput(x, target) ? Infinity : undefined;
  }
  // The scale of a dyadic literal: 1 for an integer, 256 for a multiple of
  // 1/256, `undefined` otherwise.
  const integerLike = (e: Expression): 1 | 256 | undefined => {
    if (isNumber(e)) {
      if (e.isComplex) return undefined;
      const v = e.re;
      if (Number.isInteger(v) && Math.abs(v) < 2 ** 24) return 1;
      if (Number.isInteger(v * 256) && Math.abs(v) < 2 ** 16) return 256;
      return undefined;
    }
    if (isSymbol(e)) return e.type.matches('integer') ? 1 : undefined;
    if (!isFunction(e)) return undefined;
    // A rounding function gives the float64 integer only when its argument
    // is exact: `Floor(10x)` rounds `10x` first, and can land on the other
    // side of an integer.
    if (['Floor', 'Ceil', 'Round', 'Truncate'].includes(e.operator))
      return e.nops === 1 &&
        e.ops[0] !== undefined &&
        exactOperand(e.ops[0], target) !== undefined
        ? 1
        : undefined;
    if (['Add', 'Subtract', 'Negate'].includes(e.operator)) {
      let scale: 1 | 256 = 1;
      for (const op of e.ops) {
        const s = integerLike(op);
        if (s === undefined) return undefined;
        if (s === 256) scale = 256;
      }
      return scale;
    }
    if (e.operator === 'Multiply')
      return e.ops.every((op) => integerLike(op) === 1) ? 1 : undefined;
    return undefined;
  };
  const scale = integerLike(x);
  if (scale === undefined) return undefined;
  return scale === 1 ? 2 ** 24 : 2 ** 16;
}

/**
 * A term `K·x` of the angle: `k` is the literal factor, `pi` whether the term
 * also has the factor π, and `x` an expression or a component of a vector.
 */
type HashTerm = {
  k: Expression;
  pi: boolean;
  x: Expression | { vector: Expression; index: number };
  exactBelow: number;
};

type HashShape = {
  outer: Expression | undefined;
  trig: 'Sin' | 'Cos';
  terms: HashTerm[];
  literals: Expression[];
  piFactors: Expression[];
};

/**
 * The shape `O·sin(Σ Kᵢ·xᵢ + c)` (or `cos`) of `u`, or `undefined`. `O` and
 * each `Kᵢ` are number literals (a `Kᵢ` may also have the factor π); each
 * `xᵢ` has an exact float32 value (`exactOperand`); `c` is a sum of constant
 * terms (exact arithmetic over literals, or such a term times π). A term may
 * be a `Dot` of a vector with a list of numbers, one term per component that
 * is not zero: the vector is a free input symbol, or a list whose components
 * are exact operands. At most 4 terms that are not constant.
 */
function hashShape(
  u: Expression,
  target: CompileTarget<Expression>,
  shapeOf: (e: Expression) => 'scalar' | 'matrix' | 'array' | 2 | 3 | 4
): HashShape | undefined {
  let outer: Expression | undefined;
  let trig: Expression = u;
  if (isFunction(u, 'Multiply') && u.nops === 2) {
    const [o, t] = isNumber(u.ops[0])
      ? [u.ops[0], u.ops[1]]
      : [u.ops[1], u.ops[0]];
    if (!isNumber(o) || o.isComplex || !Number.isFinite(o.re)) return undefined;
    if (Math.abs(o.re) > GPU_EXACT_TRIG_MAX_OUTER) return undefined;
    outer = o;
    trig = t;
  }
  if (!isFunction(trig, 'Sin') && !isFunction(trig, 'Cos')) return undefined;
  if (BaseCompiler.isComplexValued(trig)) return undefined;
  const arg = trig.ops[0];
  if (arg === undefined) return undefined;

  const terms: HashTerm[] = [];
  const literals: Expression[] = [];
  const piFactors: Expression[] = [];
  const isLiteral = (e: Expression): boolean =>
    isNumber(e) && !e.isComplex && Number.isFinite(e.re);
  const scalarReal = (e: Expression): boolean =>
    shapeOf(e) === 'scalar' && !BaseCompiler.isComplexValued(e);
  const ce = u.engine;
  const pushTerm = (k: Expression, pi: boolean, x: Expression): boolean => {
    if (!scalarReal(x)) return false;
    const exactBelow = exactOperand(x, target);
    if (exactBelow === undefined) return false;
    terms.push({ k, pi, x, exactBelow });
    return true;
  };
  const addTerm = (t: Expression): boolean => {
    const c = gpuExactConstant(t);
    if (c !== undefined) {
      literals.push(c);
      return true;
    }
    const piPart = BaseCompiler.piMultiple(t);
    const piConstant =
      piPart === undefined ? undefined : gpuExactConstant(piPart);
    if (piConstant !== undefined) {
      piFactors.push(piConstant);
      return true;
    }
    // `K·π·x`: the factor π joins `K` (`piMultiple` checks that `Pi` is the
    // library constant).
    const pi = piPart !== undefined;
    const body = piPart ?? t;
    if (isFunction(body, 'Negate') && body.ops[0] !== undefined)
      return pushTerm(ce.number(-1), pi, body.ops[0]);
    if (isFunction(body, 'Multiply')) {
      const index = body.ops.findIndex(isLiteral);
      if (index >= 0) {
        const rest = body.ops.filter((_, i) => i !== index);
        if (rest.length !== 1) return false;
        return pushTerm(body.ops[index], pi, rest[0]);
      }
    }
    if (!pi && isFunction(body, 'Dot') && body.nops === 2) {
      const [a, b] = body.ops;
      const [vector, list] =
        isFunction(b, 'List') || isFunction(b, 'Tuple') ? [a, b] : [b, a];
      if (
        !(isFunction(list, 'List') || isFunction(list, 'Tuple')) ||
        !list.ops.every(isLiteral) ||
        shapeOf(vector) !== list.nops ||
        vector.isPure === false
      )
        return false;
      // The vector: a free input symbol, whose components are exact, or a
      // list literal whose components are exact operands.
      const componentBound = (index: number): number | undefined => {
        if (isSymbol(vector))
          return isFreeInput(vector, target) ? Infinity : undefined;
        if (isFunction(vector, 'List') || isFunction(vector, 'Tuple')) {
          const component = vector.ops[index];
          return component === undefined
            ? undefined
            : exactOperand(component, target);
        }
        return undefined;
      };
      for (let index = 0; index < list.nops; index++) {
        if (list.ops[index].re === 0) continue;
        const exactBelow = componentBound(index);
        if (exactBelow === undefined) return false;
        terms.push({
          k: list.ops[index],
          pi: false,
          x: { vector, index },
          exactBelow,
        });
      }
      return true;
    }
    return pushTerm(ce.One, pi, body);
  };
  const ops = isFunction(arg, 'Add') ? arg.ops : [arg];
  if (!ops.every(addTerm)) return undefined;
  if (terms.length === 0 || terms.length > 4) return undefined;
  return {
    outer,
    trig: trig.operator as 'Sin' | 'Cos',
    terms,
    literals,
    piFactors,
  };
}

/**
 * The value `K` (times π when `pi`) as two float32 parts `hi + lo`, and the
 * magnitude of what the two parts leave out, `|K − hi − lo|`, computed with
 * `BigDecimal` at 50 digits.
 */
function float32Parts(
  k: Expression | undefined,
  pi: boolean
): { hi: number; lo: number; residual: number } {
  if (k === undefined) return { hi: 1, lo: 0, residual: 0 };
  const savedPrecision = BigDecimal.precision;
  try {
    BigDecimal.precision = 50;
    let v = gpuBigValue(k) ?? new BigDecimal(k.re);
    if (pi) v = v.mul(BigDecimal.PI);
    const hi = Math.fround(v.toNumber());
    const rest = v.sub(new BigDecimal(hi));
    const lo = Math.fround(rest.toNumber());
    const residual = Math.abs(rest.sub(new BigDecimal(lo)).toNumber());
    return { hi, lo, residual };
  } finally {
    BigDecimal.precision = savedPrecision;
  }
}

/** The largest float32 value that is not above `v`. */
function float32AtMost(v: number): number {
  if (!Number.isFinite(v)) return v;
  let f = Math.fround(v);
  if (f > v) f = Math.fround(f * (1 - 2 ** -24));
  return f;
}

const SWIZZLE = ['x', 'y', 'z', 'w'];

/**
 * The lowering of `Mod(u, m)` and `Fract(u)` on a shader target when the
 * float32 value of `u` can have no relation to its exact value
 * (`isAmplifiedTrig`), or `undefined` when the caller emits its usual code.
 * `undefined` also when `u` mentions an operator the caller maps to its own
 * code: that code decides the value.
 *
 * On GLSL, with `m = 1` and the shape `hashShape` accepts, the exact form; its
 * bounds are recorded for `CompilationResult.float32Bounds`. Otherwise the
 * usual float32 code, with a warning recorded for `CompilationResult.warnings`
 * (`'float32-unsafe-argument'`, kind `'correctness'`): the compile succeeds,
 * and the caller decides whether that value is good enough (a noise texture
 * may be; a curve that the hash positions is not). User decision 2026-10-18,
 * at the request of Tycho, which measured that a decline moved its 2-D field
 * rows to the CPU at up to 2.7 s per zoom.
 */
export function gpuAmplifiedTrigMod(
  head: 'Mod' | 'Fract',
  u: Expression,
  divisorIsOne: boolean,
  compile: (e: Expression) => string,
  target: CompileTarget<Expression>,
  shapeOf: (e: Expression) => 'scalar' | 'matrix' | 'array' | 2 | 3 | 4,
  plainCode: () => string
): string | undefined {
  if (mentionsOverride(u, target.foldExcludedOps)) return undefined;
  if (!isAmplifiedTrig(u)) return undefined;
  const plain = (reason: string): string => {
    const text = plainCode();
    records(target)?.warnings.push({
      text,
      warning: {
        code: 'float32-unsafe-argument',
        kind: 'correctness',
        value: u.toString(),
        message:
          `The operand of \`${head}\` amplifies a trigonometric value by a ` +
          `constant of magnitude 1000 or more, so its float32 value on ` +
          `${target.language ?? 'a shader'} can have no relation to the exact ` +
          `value (a sine hash such as \`fract(43758.5·sin(12.9898·x))\`). ${reason}`,
      },
    });
    return text;
  };
  const shape =
    target.language === 'glsl' && divisorIsOne && shapeOf(u) === 'scalar'
      ? hashShape(u, target, shapeOf)
      : undefined;
  if (shape === undefined)
    return plain(
      target.language === 'glsl'
        ? 'The exact form covers `Mod(O·sin(Σ K·x + c), 1)` (or `cos`, or a ' +
            '`Dot` with a list of numbers) with |O| ≤ 50000 and each x an ' +
            'input or an integer-valued expression.'
        : 'This target has no exact form.'
    );

  // The constant term, reduced by π/2 at compile time: `c = q·π/2 + r` with
  // `|r| ≤ π/4`, and `r` as two float32 parts. Computed before any operand is
  // compiled, so that the usual code can still be emitted instead.
  let constant: { hi: number; lo: number; q: number } | undefined;
  if (shape.literals.length + shape.piFactors.length > 0) {
    constant = gpuWithExactConstant(shape.literals, shape.piFactors, (c) => {
      const quarter = BigDecimal.PI.div(2);
      const k = c.div(quarter).round();
      const r = c.sub(k.mul(quarter));
      const q = k.sub(k.div(4).floor().mul(4)).toNumber();
      const hi = Math.fround(r.toNumber());
      const lo = Math.fround(r.sub(new BigDecimal(hi)).toNumber());
      return { hi, lo, q };
    });
    // A constant that cannot be computed exactly (more than 10 000 digits)
    // cannot be left out either: the value would be wrong.
    if (constant === undefined)
      return plain(
        'The constant term of the trigonometric argument is too large to ' +
          'reduce exactly.'
      );
  }

  const ce = u.engine;
  const outer = float32Parts(shape.outer, false);
  const reductions: string[] = [];
  const bounds: Float32Bound[] = [];
  for (const term of shape.terms) {
    const k = float32Parts(term.k, term.pi);
    let code: string;
    let operand: string;
    if ('vector' in term.x) {
      // A list literal: its component alone. A vector symbol: one swizzle.
      const v = term.x.vector;
      const component =
        isFunction(v, 'List') || isFunction(v, 'Tuple')
          ? v.ops[term.x.index]
          : undefined;
      code =
        component !== undefined
          ? compile(component)
          : `(${compile(v)}).${SWIZZLE[term.x.index]}`;
      operand = ce
        .function('At', [term.x.vector, ce.number(term.x.index + 1)])
        .toString();
    } else {
      code = compile(term.x);
      operand = term.x.toString();
    }
    const maxAbs = float32AtMost(
      Math.min(
        GPU_EXACT_TRIG_LIMIT / Math.abs(k.hi),
        k.residual > 0
          ? GPU_EXACT_TRIG_CONSTANT_BUDGET / (Math.abs(outer.hi) * k.residual)
          : Infinity,
        term.exactBelow
      )
    );
    reductions.push(
      `_gpu_xred(${code}, ${formatFloat(k.hi, 'glsl')}, ${formatFloat(k.lo, 'glsl')}, ${formatFloat(maxAbs, 'glsl')})`
    );
    bounds.push({ operand, maxAbs });
  }
  if (
    constant !== undefined &&
    (constant.hi !== 0 || constant.lo !== 0 || constant.q !== 0)
  )
    reductions.push(
      `vec4(${formatFloat(constant.hi, 'glsl')}, ${formatFloat(constant.lo, 'glsl')}, ${formatFloat(constant.q, 'glsl')}, 1.0)`
    );
  const angle = reductions.reduce((a, b) => `_gpu_xred_add(${a}, ${b})`);
  const text = `_gpu_xhash_${shape.trig === 'Sin' ? 'sin' : 'cos'}(${angle}, ${formatFloat(outer.hi, 'glsl')}, ${formatFloat(outer.lo, 'glsl')})`;
  const r = records(target);
  for (const bound of bounds) r?.bounds.push({ bound, text });
  return text;
}
