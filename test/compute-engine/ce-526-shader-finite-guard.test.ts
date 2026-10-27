/**
 * The NaN-safe shader helpers (`_gpu_sin`, `_gpu_max`, `_gpu_clamp`, …,
 * `gpuNaNSafeLibrary` in `compilation/gpu-target.ts`) give NaN for a NaN
 * operand, where the built-ins give 0 on Apple GPUs. An operand that is
 * finite for certain needs no such guard, and keeps the built-in
 * (`gpuProvablyFinite`): its static type is a finite real, each symbol it
 * reads has a declared type, and it reads no name the caller maps to its
 * own source. The guard cost about 10% of the frame time of Tycho's
 * `voronoi-diagram` on WebGPU.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');
ce.declare('u', 'number');
ce.assign('p', ce.parse('k \\mapsto \\cos(x + 1.9k)'));

const code = (expr: unknown, to: 'glsl' | 'wgsl', options = {}) =>
  compile(typeof expr === 'string' ? ce.parse(expr) : ce.box(expr as never), {
    to,
    fallback: false,
    ...options,
  } as never);

describe.each(['glsl', 'wgsl'] as const)('on %s', (to) => {
  it('a finite operand keeps the built-in', () => {
    expect(code('\\sin(x)', to).code).toBe('sin(x)');
    expect(code('\\cos(x + 1.9)', to).code).toBe('cos(x + 1.9)');
    expect(code('\\max(x, y)', to).code).toBe('max(x, y)');
    expect(code(['Clamp', 'x', 0, 1], to).code).toBe('min(max(x, 0.0), 1.0)');
    expect(code(['Sign', 'x'], to).code).toBe('sign(x)');
    // The index of an unrolled sum is a declared integer.
    expect(code('\\sum_{k=1}^{2} \\cos(x + k)', to).code).toBe(
      '((cos(1.0 + x)) + (cos(2.0 + x)))'
    );
  });

  it('an operand that may be NaN keeps the guard', () => {
    // A `number` may hold NaN; `x/y` is `0/0` at the origin; `√x` of a
    // negative is NaN on the GPU.
    expect(code('\\sin(u)', to).code).toBe('_gpu_sin(u)');
    expect(code('\\sin(x/y)', to).code).toBe('_gpu_sin(x / y)');
    expect(code('\\sin(\\sqrt{x})', to).code).toBe('_gpu_sin(sqrt(x))');
    expect(code('\\max(x, u)', to).code).toBe('_gpu_max(x, u)');
    expect(code(['Clamp', ['Divide', 'x', 'y'], 0, 1], to).code).toBe(
      '_gpu_clamp(x / y, 0.0, 1.0)'
    );
  });

  it('an operand that can overflow in f32 keeps the guard', () => {
    // `cosh(x) − sinh(x)` is typed `real`, but at x = 100 it is `∞ − ∞` in
    // f32; `e^x` and `x·y` can be `+∞`.
    expect(code('\\cos(\\cosh(x)-\\sinh(x))', to).code).toBe(
      '_gpu_cos(-sinh(x) + cosh(x))'
    );
    expect(code('\\sin(e^x)', to).code).toBe('_gpu_sin(exp(x))');
    expect(code('\\sin(xy)', to).code).toBe('_gpu_sin(x * y)');
    // A product by a literal, and a quotient by one, cannot overflow more
    // than a sum can.
    expect(code('\\sin(2x+1)', to).code).toBe('sin(2.0 * x + 1.0)');
    // A constant is read by its value: Γ(40) ≈ 2·10⁴⁶ is +∞ in f32.
    expect(code('\\sin(x+\\Gamma(20))', to).code).toMatch(/^sin\(/);
    expect(code('\\sin(x+\\Gamma(40))', to).code).toMatch(/^_gpu_sin\(/);
  });

  it('a clamp with reversed bounds keeps the interpreter result', () => {
    // The built-in `clamp` has no defined result when lo > hi.
    expect(code(['Clamp', 'x', 1, 0], to).code).toBe('min(max(x, 1.0), 0.0)');
  });

  it('a parameter whose type is inferred keeps the guard', () => {
    // `p(0/0)` is NaN in the interpreter.
    expect(code('p(x)', to).preamble).toContain('_gpu_cos(1.9 * k + x)');
  });

  it('a name the caller maps to its own source keeps the guard', () => {
    expect(
      code(['Sin', ['Add', 'x', ['Gamma', 20]]], to, {
        functions: { Gamma: 'myGamma' },
      }).code
    ).toBe('_gpu_sin(x + myGamma(20.0))');
  });
});
