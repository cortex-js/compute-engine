import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Two consumer-reported items from the 0.115.0 adoption, both fixed
 * 2026-08-17.
 *
 * **201 — `CompilationResult.mode` reports the RESOLVED discipline.** The
 * field is documented as "the arithmetic discipline the returned code was
 * compiled under". Under the `auto` default a promotable head is lowered
 * through the complex kernel WITHOUT any `LaneMismatch` escalation, so the
 * emitted code computes in the complex kernel and returns `{re, im}` — yet
 * the report used to say `'strict'`, contradicting `promoted: true` on the
 * same result. `mode` is now the latched DISCIPLINE, widened to `'complex'`
 * when a promotable head was PROMOTED. `'auto'` is never a reported value: it
 * is a policy over the two disciplines, so no public type changed.
 *
 * The widening is NOT "complex whenever the complex kernel ran", and the
 * difference is pinned below: an operand that is ALREADY complex-typed routes
 * through the complex kernel in every discipline and is deliberately not
 * counted as a promotion, so `Sqrt(z)` with `z: complex` emits `_SYS.csqrt`
 * and still reports `('strict', false)`. `mode` is therefore neither a lane
 * oracle nor a shader-portability test; the only sound per-sample test of a
 * returned value's shape is `typeof v === 'number'`.
 *
 * (The second item, 202, made the warnings about the deprecated
 * `realOnly`/`complexPromotion` options reach the target-level entry. Both
 * options and their warnings have since been removed, and its tests with
 * them.)
 *
 * `x = -1` throughout: `\sqrt{x}` promotes there, and `\sqrt{x^2+1}` is the
 * "wide is real" control that must NOT promote.
 */

describe('201 — mode reports the resolved discipline', () => {
  test('the auto default reports complex when a head was promoted', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{x}'), { to: 'javascript' }) as any;
    // `success: false` would be the interpreter fallback, which carries a
    // working `run` AND a mode report of its own — so without this the whole
    // test is satisfiable by a compile that declined and emitted nothing.
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(true);
    expect(r.mode).toBe('complex');
    // The behaviour that makes 'strict' the wrong answer: the emitted code
    // computes in the complex kernel and hands back a complex value. Assert
    // the EMISSION, not just the report: `_SYS.csqrt` is the JavaScript
    // target's complex square-root helper, so its presence witnesses that the
    // complex kernel was actually lowered into the source.
    expect(r.code).toContain('_SYS.csqrt');
    expect(typeof r.run({ x: -1 })).toBe('object');
  });

  test('an explicit strict compile still reports strict', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{x}'), {
      to: 'javascript',
      mode: 'strict',
    }) as any;
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(false);
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

  // The control that distinguishes "reports the resolved discipline" from
  // "always says complex under the default".
  test('a non-promoting default compile still reports strict', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{x^2+1}'), { to: 'javascript' }) as any;
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(false);
    expect(r.mode).toBe('strict');
    expect(r.code).not.toContain('_SYS.csqrt');
    expect(typeof r.run({ x: -1 })).toBe('number');
  });

  // The carve-out that makes "complex whenever the complex kernel ran" the
  // WRONG reading of this field. An operand that is already complex-TYPED
  // routes through the complex kernel in every discipline, and
  // `promotesRadicalToComplex` deliberately excludes it from `notePromoted()`
  // (the `!isNonRealNumber(a.type.type)` conjunct in `base-compiler.ts`),
  // because there is no promotion — the value was complex to begin with. So
  // this compile EMITS `_SYS.csqrt` and still reports `('strict', false)`.
  // Consequence for consumers, and the reason this row exists:
  // `mode: 'strict'` does not certify a real-only emission, so it is neither a
  // lane oracle nor a shader-portability test.
  test('a complex-TYPED operand takes the complex kernel without moving mode', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    const r = compile(ce.parse('\\sqrt{z}'), { to: 'javascript' }) as any;
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.csqrt');
    expect(r.promoted).toBe(false);
    expect(r.mode).toBe('strict');
  });

  // A DECLINE emitted no code, so it must not inherit a discipline. The
  // report is frozen in a `finally`, which also runs on the throw path, and
  // `buildInterpreterFallback` spreads that report onto a `success: false`
  // result — so before the fix a compile that noted a promotion and THEN
  // declined handed back `('complex', true)` describing code that was never
  // emitted. `Sqrt(x-1)` promotes (unknown sign), and `Solve` has no
  // JavaScript lowering, so this expression does both in that order.
  test('a declined compile reports the neutral mode, not a promoted one', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{x-1} + \\operatorname{Solve}(y)'), {
      to: 'javascript',
      fallback: true,
    }) as any;
    expect(r.success).toBe(false);
    expect(r.mode).toBe('strict');
    expect(r.promoted).toBe(false);
  });

  test("'auto' is never a reported mode, even when requested", () => {
    const ce = new ComputeEngine();
    for (const latex of ['\\sqrt{x}', '\\sqrt{x^2+1}', '2x+1']) {
      const r = compile(ce.parse(latex), {
        to: 'javascript',
        mode: 'auto',
      }) as any;
      expect(r.success).toBe(true);
      expect(['strict', 'complex']).toContain(r.mode);
    }
  });

  // A promoted compile reports 'complex' — the discipline the code was
  // EMITTED under — even where the value handed back at a given sample point
  // is a plain real number. This is the row where the reported mode and the
  // returned value look least alike, which is exactly why it is pinned.
  test('a promoted compile reports complex whatever shape a sample returns', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.parse('\\sqrt{x}'), { to: 'javascript' }) as any;
    expect(r.success).toBe(true);
    expect(r.promoted).toBe(true);
    expect(r.mode).toBe('complex');
    expect(r.code).toContain('_SYS.csqrt');
    // `√4 = 2` is exactly real, so the complex-emitted runner returns a plain
    // number here; at `x = -1` it returns a `{re, im}`. The mode is 'complex'
    // for both.
    expect(typeof r.run({ x: 4 })).toBe('number');
    expect(typeof r.run({ x: -1 })).toBe('object');
  });
});
