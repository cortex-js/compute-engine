import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Two consumer-reported items from the 0.115.0 adoption, both fixed
 * 2026-08-17.
 *
 * **201 — `CompilationResult.mode` reports the discipline.** The field is
 * documented as "the arithmetic discipline the returned code was compiled
 * under". It is the requested mode, `'strict'` when no mode is requested.
 *
 * `mode` is not "complex whenever the complex kernel ran", and the
 * difference is pinned below: an operand that is ALREADY complex-typed routes
 * through the complex kernel in every discipline, so `Sqrt(z)` with
 * `z: complex` emits `_SYS.csqrt` and still reports `'strict'`. `mode` is
 * therefore neither a lane oracle nor a shader-portability test; the only
 * sound per-sample test of a returned value's shape is
 * `typeof v === 'number'`.
 *
 * (The second item, 202, made the warnings about the deprecated
 * `realOnly`/`complexPromotion` options reach the target-level entry. Both
 * options and their warnings have since been removed, and its tests with
 * them.)
 *
 * `x = -1` throughout: `\sqrt{x}` is complex there, and `\sqrt{x^2+1}` is the
 * "wide is real" control.
 */

describe('201 — mode reports the resolved discipline', () => {
  test('an explicit strict compile still reports strict', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{x}'), {
      to: 'javascript',
      mode: 'strict',
    }) as any;
    expect(r.success).toBe(true);
    expect(r.mode).toBe('strict');
    // The real kernel, not the complex one.
    expect(r.code).toContain('Math.sqrt');
    expect(r.code).not.toContain('_SYS.csqrt');
    expect(Number.isNaN(r.run({ x: -1 }))).toBe(true);
  });

  test('an explicit complex compile reports complex', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{x}'), {
      to: 'javascript',
      mode: 'complex',
    }) as any;
    expect(r.success).toBe(true);
    expect(r.mode).toBe('complex');
    expect(r.code).toContain('_SYS.csqrt');
  });

  // The default is strict: the real kernel, and a real result.
  test('a default compile reports strict', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{x^2+1}'), { to: 'javascript' }) as any;
    expect(r.success).toBe(true);
    expect(r.mode).toBe('strict');
    expect(r.code).not.toContain('_SYS.csqrt');
    expect(typeof r.run({ x: -1 })).toBe('number');
  });

  // The carve-out that makes "complex whenever the complex kernel ran" the
  // WRONG reading of this field. An operand that is already complex-TYPED
  // routes through the complex kernel in every discipline, so this compile
  // EMITS `_SYS.csqrt` and still reports `'strict'`.
  // Consequence for consumers, and the reason this row exists:
  // `mode: 'strict'` does not certify a real-only emission, so it is neither a
  // lane oracle nor a shader-portability test.
  test('a complex-TYPED operand takes the complex kernel without moving mode', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    const r = compile(ce.parse('\\sqrt{z}'), { to: 'javascript' }) as any;
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.csqrt');
    expect(r.mode).toBe('strict');
  });

  // A DECLINE emitted no code. `buildInterpreterFallback` spreads the mode
  // report onto the `success: false` result, and that report is the
  // requested discipline. `Solve` has no JavaScript lowering, so this
  // expression declines.
  test('a declined compile reports the neutral mode', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{x-1} + \\operatorname{Solve}(y)'), {
      to: 'javascript',
      fallback: true,
    }) as any;
    expect(r.success).toBe(false);
    expect(r.mode).toBe('strict');
  });

  // The mode 'auto' was removed: requesting it declines with the
  // `unsupported-mode` diagnostic.
  test("'auto' is never a reported mode, even when requested", () => {
    const ce = new ComputeEngine();
    for (const latex of ['\\sqrt{x}', '\\sqrt{x^2+1}', '2x+1']) {
      const r = compile(ce.parse(latex), {
        to: 'javascript',
        mode: 'auto',
      } as any) as any;
      expect(r.success).toBe(false);
      expect(r.diagnostic?.code).toBe('unsupported-mode');
      expect(['strict', 'complex']).toContain(r.mode);
    }
  });

  // A complex compile reports 'complex' — the discipline the code was
  // EMITTED under — even where the value handed back at a given sample point
  // is a plain real number. This is the row where the reported mode and the
  // returned value look least alike, which is exactly why it is pinned.
  test('a complex compile reports complex whatever shape a sample returns', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{x}'), {
      to: 'javascript',
      mode: 'complex',
    }) as any;
    expect(r.success).toBe(true);
    expect(r.mode).toBe('complex');
    expect(r.code).toContain('_SYS.csqrt');
    // `√4 = 2` is exactly real, so the complex-emitted runner returns a plain
    // number here; at `x = -1` it returns a `{re, im}`. The mode is 'complex'
    // for both.
    expect(typeof r.run({ x: 4 })).toBe('number');
    expect(typeof r.run({ x: -1 })).toBe('object');
  });
});
