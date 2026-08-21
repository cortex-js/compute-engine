import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { resetDeprecationWarnings } from '../../src/compute-engine/compilation/deprecation-warnings';

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
 * **202 — the deprecation warnings reach the target-level entry.** They used
 * to live only in the standalone `compile()` export, so a caller going
 * through `ce._getCompilationTarget(name).compile(...)` — the route an
 * integration takes once it needs a specific target — got no signal at all
 * while `realOnly`/`complexPromotion` kept working. `realOnly` has since been
 * REMOVED; both routes still warn about the key so an untyped caller learns
 * the projection is gone rather than silently losing it.
 *
 * `x = -1` throughout: `\sqrt{x}` promotes there, and `\sqrt{x^2+1}` is the
 * "wide is real" control that must NOT promote.
 */

function capture(fn: () => void): string[] {
  const seen: string[] = [];
  const original = console.warn;
  console.warn = (m: unknown) => {
    seen.push(String(m));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return seen;
}

// The once-per-process warning keys are consumed by the FIRST case that
// touches them, so a case that asserts on a key an earlier case already
// consumed sees silence and reads it as a regression — which is how this file
// first failed. The reset is at FILE scope, not inside the 202 describe, so a
// case in any other describe that consumes a key cannot starve one that
// asserts on it (jest may run describes in any order, `--randomize`).
beforeEach(() => resetDeprecationWarnings());

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

describe('202 — deprecation warnings reach the target-level compile entry', () => {
  test('a target-level compile with no deprecated option warns about none', () => {
    const ce = new ComputeEngine();
    const target = (ce as any)._getCompilationTarget('javascript');
    const warnings = capture(() =>
      target.compile(ce.parse('\\sqrt{x}'), { mode: 'strict' })
    );
    expect(
      warnings.filter((w) => /realOnly|complexPromotion/.test(w))
    ).toHaveLength(0);
  });

  // `realOnly` is REMOVED, not merely deprecated: it no longer projects
  // anything. The warning stays because an untyped JavaScript caller can still
  // pass the key, and silence would let the projection disappear unnoticed.
  test('a target-level compile warns about the removed realOnly, once', () => {
    const ce = new ComputeEngine();
    const target = (ce as any)._getCompilationTarget('javascript');
    const first = capture(() =>
      target.compile(ce.parse('\\sqrt{x}'), { realOnly: true })
    );
    expect(first.filter((w) => w.includes('realOnly')).length).toBeGreaterThan(
      0
    );
    // Once per process: a second call on the same key stays silent.
    const second = capture(() =>
      target.compile(ce.parse('\\sqrt{x}'), { realOnly: true })
    );
    expect(second.filter((w) => w.includes('realOnly'))).toHaveLength(0);
  });

  test('a target-level compile warns about complexPromotion', () => {
    const ce = new ComputeEngine();
    const target = (ce as any)._getCompilationTarget('javascript');
    const warnings = capture(() =>
      target.compile(ce.parse('\\sqrt{x}'), { complexPromotion: true })
    );
    expect(
      warnings.filter((w) => w.includes('complexPromotion')).length
    ).toBeGreaterThan(0);
  });

  // A standalone `compile()` call passes through BOTH warning sites: the
  // standalone entry warns and normalizes the deprecated option onto `mode`,
  // then hands off to the target, whose own entry would warn again — the
  // once-per-key Set is what keeps it to a single message. Nothing else pins
  // that, so a change to the normalization could start double-warning
  // undetected.
  test('the standalone entry warns exactly once about the removed realOnly, across both routes', () => {
    const ce = new ComputeEngine();
    const warnings = capture(() =>
      compile(ce.parse('\\sqrt{x}'), {
        to: 'javascript',
        realOnly: true,
      } as any)
    );
    expect(warnings.filter((w) => w.includes('realOnly'))).toHaveLength(1);
  });

  test('the standalone entry warns exactly once about complexPromotion, across both routes', () => {
    const ce = new ComputeEngine();
    const warnings = capture(() =>
      compile(ce.parse('\\sqrt{x}'), {
        to: 'javascript',
        complexPromotion: true,
      } as any)
    );
    expect(warnings.filter((w) => w.includes('complexPromotion'))).toHaveLength(
      1
    );
  });

  // Under `auto`, a promotable unknown-sign radical reaching a user
  // function's wide parameter is a `LaneMismatch`: the strict attempt
  // declines and the TARGET is compiled a second time in complex mode. That
  // doubles the number of times the target-level warning site is reached, so
  // it is the sharpest test of the once-per-key suppression.
  test('the auto escalation retry compiles the target twice but still warns once', () => {
    const ce = new ComputeEngine();
    ce.parse('f(t) \\coloneq t + 1').evaluate();
    let r: any;
    const warnings = capture(() => {
      r = compile(ce.parse('f(\\sqrt{k})'), {
        to: 'javascript',
        realOnly: true,
      } as any) as any;
    });
    // Witness that the retry actually happened — `escalation` carries the
    // diagnostic of the failed strict attempt.
    expect(r.success).toBe(true);
    expect(r.escalation).toBeDefined();
    expect(warnings.filter((w) => w.includes('realOnly'))).toHaveLength(1);
  });
});
