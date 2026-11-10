// A target object made by `GLSLTarget.createTarget()` and passed to
// `compile()` as the `target` option skips the `compile()` of the GLSL
// target. Its lowerings do not check the operand shapes: the fragment pass
// refuses an operator whose signature does not take the operand types. So
// the target object carries the pass, and `compile()` runs it on that route
// too (`src/compute-engine/compilation/raw-target-check.ts`). Without it,
// `Arctan2(v, x)` with `v` a `vec3` and `x` a scalar wrote `atan(v, x)`,
// which no shader compiler accepts, behind `success: true`.

import { ComputeEngine } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

const ce = new ComputeEngine();
ce.declare('v', 'list<real^3>');
ce.declare('w', 'list<real^2>');
ce.declare('x', 'real');

const raw = () => new GLSLTarget().createTarget();

describe('GLSL TARGET OBJECT PASSED AS `target`', () => {
  test.each([
    [['Arctan2', 'v', 'x'], 'Arctan2'],
    [['Add', 'v', 'w'], 'Add'],
    [['Hypot', 'v', 'v'], 'Hypot'],
    [['Clamp', 'x', 'v', 'v'], 'Clamp'],
  ])('%j declines with the diagnostic of the fragment pass', (json, head) => {
    const expr = ce.box(json as any);
    const result = ce._compile(expr, { target: raw() });
    expect(result.success).toBe(false);
    expect(result.diagnostic?.code).toBe('outside-fragment');
    expect(result.diagnostic?.message).toContain(
      `No signature of \`${head}\` in the GLSL fragment`
    );
    // The same verdict as the registered route.
    expect(ce._compile(expr, { to: 'glsl' }).success).toBe(false);
  });

  test('an object spread copy of the target object runs the pass too', () => {
    // `preamble` is a field that `compile()` does not reset on this route.
    const copy = { ...raw(), preamble: '' };
    const result = ce._compile(ce.box(['Arctan2', 'v', 'x']), {
      target: copy,
    });
    expect(result.success).toBe(false);
    expect(result.diagnostic?.code).toBe('outside-fragment');
  });

  test('a `functions` entry does not exempt a head: the raw route writes the stock lowering', () => {
    const result = ce._compile(ce.box(['Arctan2', 'v', 'x']), {
      target: raw(),
      functions: { Arctan2: 'customAtan' },
    });
    expect(result.success).toBe(false);
    expect(result.diagnostic?.code).toBe('outside-fragment');
  });

  test('an admitted expression compiles', () => {
    const expr = ce.box(['Add', ['Sin', 'v'], 'x']);
    const direct = ce._compile(expr, { target: raw(), fallback: false });
    expect(direct.success).toBe(true);
    // The raw route has no finite proof of `v`, so it calls the NaN-safe
    // helper where the registered route writes the built-in `sin(v)`.
    expect(direct.code).toBe('x + _gpu_sin3(v)');
  });
});
