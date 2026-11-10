/**
 * A call of a head that the caller implements (the `functions` option of
 * `compile()`) has, in the GLSL fragment check, the declared result type of
 * its operator when that type is a color, a point, a complex number or a
 * boolean. Every other result (no declaration, a number, an integer) is read
 * as a real. Tycho declares `colormap` as `(any, any) -> color` and compiles
 * it with `functions: { colormap: 'tychoColormap' }`: a color operator
 * applied to that call must compile.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function glsl(ce: ComputeEngine, json: any, functions: Record<string, string>) {
  return compile(ce.box(json), { to: 'glsl', functions } as any) as any;
}

describe('GLSL: the result type of a call of a functions entry', () => {
  test('a color result is a color', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('g', { signature: '(any, any) -> color' });
    const r = glsl(ce, ['AsOklab', ['g', 0, 'x']], { g: 'hostG' });
    expect(r.success).toBe(true);
    expect(r.code).toContain('hostG(0.0, x)');
  });

  test('a point result is a point', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('p', { signature: '(real) -> tuple<real, real>' });
    const r = glsl(ce, ['Add', ['p', 'x'], ['p', 1]], { p: 'hostP' });
    expect(r.success).toBe(true);
    expect(r.code).toContain('hostP(x)');
  });

  test('an undeclared head is read as a real', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const r = glsl(ce, ['Add', ['h', 'x'], 1], { h: 'hostH' });
    expect(r.success).toBe(true);
    // The call is computed once, into a temporary of type `float`
    // (`gpu-caller-binding.ts`).
    expect(r.code).toBe('float _tv1 = hostH(x);\nreturn _tv1 + 1.0;');
  });

  test('an integer result is read as a real', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('k', { signature: '(real) -> integer' });
    const r = glsl(ce, ['Add', ['k', 'x'], 'x'], { k: 'hostK' });
    expect(r.success).toBe(true);
    expect(r.code).toContain('hostK(x)');
  });
});
