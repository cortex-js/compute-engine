// NaN-safe lowerings: floor-mod, tanh, the complex reciprocal, the NaN-safe
// library and its ternary calls.

import type { Expression } from '../global-types.js';
import type { CompileTarget } from './types.js';
import { BaseCompiler } from './base-compiler.js';
import { gpuComplexOperand, gpuOperandShape } from './gpu-shapes.js';
import { gpuVecType } from './gpu-emit.js';
import { gpuProvablyFinite } from './gpu-finite-proof.js';

/**
 * The vector widths of the per-width shader helpers below: one declaration
 * per width, because the operand-shape check reads a helper's own declaration (`gpuHelperIsScalarOnly`).
 */
const GPU_HELPER_WIDTHS = [2, 3, 4] as const;

/**
 * The floored modulo `Mod(x, y)` as shader helpers: `_gpu_fmod(x, y)` for
 * scalars and `_gpu_fmod2`–`_gpu_fmod4` for vectors. A helper receives each
 * operand once, as an argument, so an operand is computed once and in the
 * order it is written, whatever the formula does with it. An inline formula
 * that splices an operand several times computes a costly one (a user
 * function call) several times, draws an impure one several times, and grows
 * by a factor of the number of splices at each level of a nested `Mod`; a
 * hoisted temporary would move the operand ahead of its siblings.
 *
 * GLSL: the built-in `mod(x, y)` is `x - y * floor(x / y)` computed in f32.
 * The quotient rounds, so for a large or exact dividend the result can fall
 * outside the range of the divisor: on WebGL2 over ANGLE Metal
 * `mod(1e8, 3.0)` is −2 (true 1), `mod(-1e6, 1000.0)` is 1000 (true 0) and
 * `mod(1e-20, -3.0)` is −3. When the quotient is above 2^24 the error can be
 * several divisors, so `mod` is applied a second time to its own result:
 * each application brings about 24 more bits of quotient into range
 * (measured with an f32 model of the formula, the result is then in range for
 * every quotient below 2^48). Then two corrections move the result into the
 * range: a result with the sign opposite to the divisor gets the divisor
 * added, then a result whose magnitude is the divisor's or more gets it
 * subtracted, which also maps a sum that rounds to exactly the divisor to 0,
 * as the interpreter's `Mod` does. With `u = r·sign(y)`, the range is
 * `0 ≤ u < |y|`. A NaN (a zero divisor) stays NaN through every step.
 * CE-511 (Tycho row 456). Using helpers is CE-512 (Tycho row 457).
 */
function gpuFloorModLibrary(): string {
  const types: [string, string][] = [
    ['_gpu_fmod', 'float'],
    ...GPU_HELPER_WIDTHS.map((n): [string, string] => [
      `_gpu_fmod${n}`,
      `vec${n}`,
    ]),
  ];
  return types
    .map(
      ([name, t]) =>
        `${t} ${name}(${t} x, ${t} y) {
  ${t} r = mod(mod(x, y), y);
  r = r + y * (1.0 - step(0.0, r * sign(y)));
  return r - y * step(abs(y), r * sign(y));
}`
    )
    .join('\n');
}

export const GPU_FLOOR_MOD_PREAMBLE_GLSL = `\n${gpuFloorModLibrary()}\n`;

/**
 * The floored modulo `Mod(a, b)` as a call of a `_gpu_fmod` helper
 * (`gpuFloorModLibrary`), or `undefined` when the operand shapes have no
 * helper: a matrix, an array, a complex operand, or two vectors of different
 * widths. A scalar beside a vector, in either position, is broadcast with the
 * vector constructor, so each helper takes two operands of one type.
 */
export function gpuFloorModCall(
  a: Expression,
  b: Expression,
  compile: (expr: Expression) => string
): string | undefined {
  if (BaseCompiler.isComplexValued(a) || BaseCompiler.isComplexValued(b))
    return undefined;
  const sa = gpuOperandShape(a);
  const sb = gpuOperandShape(b);
  const isFloatShape = (s: typeof sa): boolean =>
    s === 'scalar' || typeof s === 'number';
  if (!isFloatShape(sa) || !isFloatShape(sb)) return undefined;
  if (sa === 'scalar' && sb === 'scalar')
    return `_gpu_fmod(${compile(a)}, ${compile(b)})`;
  if (typeof sa === 'number' && typeof sb === 'number' && sa !== sb)
    return undefined;
  const width = (typeof sa === 'number' ? sa : sb) as number;
  const ctor = gpuVecType(width);
  const ca = sa === 'scalar' ? `${ctor}(${compile(a)})` : compile(a);
  const cb = sb === 'scalar' ? `${ctor}(${compile(b)})` : compile(b);
  return `_gpu_fmod${width}(${ca}, ${cb})`;
}

/**
 * The hyperbolic tangent of a real scalar or `vecN` operand: the built-in,
 * which WebGL2 over ANGLE Metal computes correctly.
 */
export function gpuRealTanh(
  x: Expression,
  compile: (expr: Expression) => string
): string {
  return `tanh(${compile(x)})`;
}

/**
 * Shader helpers that give NaN when an operand is NaN, as the interpreter and
 * the `javascript` target do, for the built-ins that do not on Apple GPUs:
 * `_gpu_max(a, b)`, `_gpu_min(a, b)`, `_gpu_clamp(x, lo, hi)`, `_gpu_sin(x)`,
 * `_gpu_cos(x)`, `_gpu_sign(x)` and `_gpu_smoothstep(e0, e1, x)` for scalars,
 * and the same names with the suffix 2, 3 or 4 for vectors, whose operands
 * all have that width. They lower `Max`, `Min`, `Clamp`, `ElementMax`,
 * `ElementMin` (CE-519, Tycho row 465), and `Sin`, `Cos`, their reciprocals,
 * `Sign` and `Smoothstep` (CE-520).
 *
 * GLSL ES 3.0 leaves `max`, `min` and `clamp` undefined for a NaN
 * operand. On Apple GPUs (WebGL2 over ANGLE Metal, Apple M5 Max,
 * 2026-10-26) they return the operand that is a number, so
 * `max(0, sqrt(1 - x²))` at x = 2 was 0, not NaN; and `sin`, `cos`, `sign`
 * and `smoothstep` of a NaN gave 0.
 *
 * The NaN test (`_gpu_isnan`, `_gpu_isnan2`–`_gpu_isnan4`) reads the bit
 * pattern: a value is NaN when its bits without the sign are larger than
 * those of +∞ (0x7F800000), because a compiler may assume that no NaN
 * occurs and fold the test `a != a`. For the same reason a NaN operand is
 * returned as it is, by a selection, and not through arithmetic. `Clamp` is computed as `min(max(x, lo), hi)`, the
 * definition of the interpreter, which is `hi` when `lo > hi`; the GLSL
 * built-in `clamp` leaves that case undefined.
 *
 * A helper receives each operand once, as an argument, so a compound operand
 * is not computed twice (see `gpuFloorModLibrary`).
 */
function gpuNaNSafeLibrary(): string {
  const mask = '0x7FFFFFFFu';
  const inf = '0x7F800000u';
  const widths: number[] = [1, ...GPU_HELPER_WIDTHS];
  const suffix = (n: number): string => (n === 1 ? '' : `${n}`);
  const isnan = (n: number, v: string): string =>
    `_gpu_isnan${suffix(n)}(${v})`;
  // The value `t` where the condition `c` is true, else `f`, with no
  // arithmetic on either value. GLSL `mix` with a boolean vector selects
  // each component.
  const select = (n: number, f: string, t: string, c: string): string =>
    n === 1 ? `(${c} ? ${t} : ${f})` : `mix(${f}, ${t}, ${c})`;
  const defs: string[] = [];
  for (const n of widths) {
    // `_gpu_isnan` tests for a NaN; `_gpu_isnonfinite` for a NaN or an
    // infinity (the bits without the sign are those of +∞ or larger).
    for (const [base, gt, glslCmp] of [
      ['_gpu_isnan', '>', 'greaterThan'],
      ['_gpu_isnonfinite', '>=', 'greaterThanEqual'],
    ] as const) {
      const name = `${base}${suffix(n)}`;
      if (n === 1) {
        defs.push(`bool ${name}(float x) {
  return (floatBitsToUint(x) & ${mask}) ${gt} ${inf};
}`);
      } else {
        defs.push(`bvec${n} ${name}(vec${n} x) {
  return ${glslCmp}(floatBitsToUint(x) & ${mask}, uvec${n}(${inf}));
}`);
      }
    }
  }
  const fn = (
    name: string,
    params: string[],
    t: string,
    body: string
  ): string =>
    `${t} ${name}(${params.map((p) => `${t} ${p}`).join(', ')}) {
  return ${body};
}`;
  for (const n of widths) {
    const t = n === 1 ? 'float' : `vec${n}`;
    const s = suffix(n);
    for (const op of ['max', 'min'])
      defs.push(
        fn(
          `_gpu_${op}${s}`,
          ['a', 'b'],
          t,
          select(
            n,
            select(n, `${op}(a, b)`, 'b', isnan(n, 'b')),
            'a',
            isnan(n, 'a')
          )
        )
      );
    defs.push(
      fn(
        `_gpu_clamp${s}`,
        ['x', 'lo', 'hi'],
        t,
        select(
          n,
          select(
            n,
            select(n, 'min(max(x, lo), hi)', 'hi', isnan(n, 'hi')),
            'lo',
            isnan(n, 'lo')
          ),
          'x',
          isnan(n, 'x')
        )
      )
    );
    defs.push(
      fn(`_gpu_sign${s}`, ['x'], t, select(n, 'sign(x)', 'x', isnan(n, 'x')))
    );
    // `sin` and `cos` of an infinity gave 0 too, where the interpreter gives
    // NaN, so their test is `_gpu_isnonfinite`, and they return a NaN built
    // from its bit pattern, as `_gpu_nan()` does: `x - x` is folded to 0 by
    // the WebGL2 compiler.
    for (const op of ['sin', 'cos']) {
      const nonfinite = `_gpu_isnonfinite${s}(x)`;
      const nan =
        n === 1
          ? 'intBitsToFloat(0x7FC00000)'
          : `${t}(intBitsToFloat(0x7FC00000))`;
      defs.push(
        fn(`_gpu_${op}${s}`, ['x'], t, select(n, `${op}(x)`, nan, nonfinite))
      );
    }
    // The interpreter's `Smoothstep`, written out: the built-in
    // `smoothstep` has no defined result when `e0 >= e1`, where the
    // interpreter gives the step function (`e0 = e1`) or the formula as
    // written (`e0 > e1`). `_gpu_hermite` is t²(3 − 2t). The quotient of the
    // branch that is not selected (`0/0` for equal edges) is discarded.
    const k = (c: string): string => (n === 1 ? c : `${t}(${c})`);
    defs.push(
      fn(`_gpu_hermite${s}`, ['t'], t, `t * t * (${k('3.0')} - 2.0 * t)`)
    );
    const equal = n === 1 ? 'e0 == e1' : 'equal(e0, e1)';
    const below = n === 1 ? 'x < e0' : 'lessThan(x, e0)';
    const formula = select(
      n,
      `_gpu_hermite${s}(min(max((x - e0) / (e1 - e0), ${k('0.0')}), ${k('1.0')}))`,
      select(n, k('1.0'), k('0.0'), below),
      equal
    );
    defs.push(
      fn(
        `_gpu_smoothstep${s}`,
        ['e0', 'e1', 'x'],
        t,
        select(
          n,
          select(
            n,
            select(n, formula, 'x', isnan(n, 'x')),
            'e1',
            isnan(n, 'e1')
          ),
          'e0',
          isnan(n, 'e0')
        )
      )
    );
  }
  return defs.join('\n');
}

/**
 * A call of the NaN-safe helper `_gpu_<name>` (`gpuNaNSafeLibrary`) on one
 * operand: the scalar helper for a scalar operand, the helper of width N for
 * a `vecN` operand, and the built-in `<name>` for a matrix or an array, so
 * that the operand-shape gate gives its reason for a decline. A complex
 * operand never reaches it: `Sin` and `Cos` lower a complex operand through
 * `_gpu_csin`/`_gpu_ccos` first, and `Sign` is a real-only lowering
 * (`GPU_REAL_ONLY_LOWERINGS`), whose complex operand the base compiler
 * declines.
 */
export function gpuNaNSafeUnary(
  name: 'sin' | 'cos' | 'sign',
  x: Expression,
  code: string,
  target: CompileTarget<Expression>
): string {
  // A finite number literal cannot be NaN or infinite, and the driver folds
  // the built-in call of a literal at compile time: the helper call
  // `_gpu_cos(2.4)` was not folded, and the small difference changed a
  // threshold test in Tycho's `voronoi-diagram` on WebGPU.
  if (GPU_FINITE_LITERAL.test(code) || gpuProvablyFinite(x, target, true))
    return `${name}(${code})`;
  const shape = gpuOperandShape(x);
  if (shape === 'scalar') return `_gpu_${name}(${code})`;
  if (typeof shape === 'number') return `_gpu_${name}${shape}(${code})`;
  return `${name}(${code})`;
}

/** A shader float literal (`2.4`, `-0.5`, `1e-3`): the operand of a
 * NaN-safe helper that needs no guard (`gpuNaNSafeUnary`). */
const GPU_FINITE_LITERAL = /^\(?-?\d+(?:\.\d*)?(?:e[-+]?\d+)?\)?$/;

export const GPU_NAN_SAFE_PREAMBLE_GLSL = `\n${gpuNaNSafeLibrary()}\n`;

/**
 * `Clamp(x, lo, hi)` or `Smoothstep(e0, e1, x)` as a call of the
 * `_gpu_clamp` or `_gpu_smoothstep` helper (`gpuNaNSafeLibrary`), or
 * `undefined` when the operand shapes have no helper: a complex operand, a
 * matrix, an array, a vector bound beside a scalar `x`, or vectors of
 * different widths. `main` is the position of `x`, whose shape sets the
 * width. A scalar bound beside a vector `x` is broadcast with the vector
 * constructor. A `clamp` whose operands are all finite for certain
 * (`gpuProvablyFinite`) is `min(max(x, lo), hi)` with the built-ins.
 */
export function gpuNaNSafeTernaryCall(
  name: 'clamp' | 'smoothstep',
  main: number,
  args: ReadonlyArray<Expression>,
  compile: (expr: Expression) => string,
  target: CompileTarget<Expression>
): string | undefined {
  if (args.length !== 3 || args.some((a) => a === null || a === undefined))
    return undefined;
  if (args.some((a) => BaseCompiler.isComplexValued(a))) return undefined;
  const shapes = args.map(gpuOperandShape);
  // Finite scalar operands of `clamp` need no NaN guard
  // (`gpuProvablyFinite`). They are written `min(max(x, lo), hi)`, as the
  // helper and the interpreter compute it: the built-in `clamp` has no
  // defined result when `lo > hi`. `smoothstep` always calls its helper,
  // which also gives the interpreter's result for `e0 >= e1`.
  if (
    name === 'clamp' &&
    shapes.every((s) => s === 'scalar') &&
    args.every((a) => gpuProvablyFinite(a, target, true))
  ) {
    const [x, lo, hi] = args.map((a) => compile(a));
    return `min(max(${x}, ${lo}), ${hi})`;
  }
  if (shapes.every((s) => s === 'scalar'))
    return `_gpu_${name}(${args.map((a) => compile(a)).join(', ')})`;
  const width = shapes[main];
  if (typeof width !== 'number') return undefined;
  if (!shapes.every((s) => s === 'scalar' || s === width)) return undefined;
  const ctor = gpuVecType(width);
  const codes = args.map((a, i) =>
    shapes[i] === 'scalar' ? `${ctor}(${compile(a)})` : compile(a)
  );
  // Finite `vecN` operands of a `clamp`, as for scalars above: `min` and
  // `max` are componentwise. A scalar bound beside the vector is broadcast
  // with the vector constructor, and the
  // proof reads the bound as written: `vecN(s)` is finite exactly when `s`
  // is. So `Clamp(v, 0, 1)` is `min(max(v, vec3(0.0)), vec3(1.0))`.
  if (name === 'clamp' && args.every((a) => gpuProvablyFinite(a, target, true)))
    return `min(max(${codes[0]}, ${codes[1]}), ${codes[2]})`;
  return `_gpu_${name}${width}(${codes.join(', ')})`;
}

/**
 * The complex lowering of a RECIPROCAL inverse head (`Arcsec`, `Arccsc`,
 * `Arsech`, `Arcoth`): a call of its preamble helper (`_gpu_casec`,
 * `_gpu_cacsc`, `_gpu_casech`, `_gpu_cacoth`), whose operand is lifted to a
 * `vec2` when it is real. The helpers do not compute `w = 1/z` and then the
 * function of `w`: near a branch point (`z = ±1`) the rounding of `1/z` is
 * amplified (with `asin(1/z)`, `arcsec(1 + 10⁻⁴i)` had a relative error of
 * `5·10⁻⁵` in f32). See the comment above `_gpu_cinvpm`.
 */
export function gpuReciprocalComplex(
  helper: string,
  x: Expression,
  compile: (expr: Expression) => string
): string {
  return `${helper}(${gpuComplexOperand(x, compile)})`;
}
