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
ce.declare('s', 'real<-10..10>');
ce.assign('p', ce.parse('k \\mapsto \\cos(x + 1.9k)'));

const code = (expr: unknown, to: 'glsl', options = {}) =>
  compile(typeof expr === 'string' ? ce.parse(expr) : ce.box(expr as never), {
    to,
    fallback: false,
    ...options,
  } as never);

describe.each(['glsl'] as const)('on %s', (to) => {

  it('a clamp with reversed bounds keeps the interpreter result', () => {
    // The built-in `clamp` has no defined result when lo > hi.
    expect(code(['Clamp', 'x', 1, 0], to).code).toBe('min(max(x, 1.0), 0.0)');
  });
});
