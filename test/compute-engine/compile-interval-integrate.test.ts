/**
 * Tests for `Integrate` on the interval JavaScript compilation target.
 *
 * Two lowerings are under test, and every case first pins WHICH one it
 * exercises by inspecting the emitted code:
 *
 * - the shared antiderivative-first step
 *   (`BaseCompiler.closedFormIntegral`), which compiles the closed form and
 *   emits the closed form as a thunk guarded by `_IA.integrateClosed` (no
 *   `_IA.integrate(` call); and
 * - the enclosure emitter, `_IA.integrate(f, lo, hi)`, which brackets the
 *   integral by a uniform partition (`src/compute-engine/interval/integrate.ts`).
 *
 * Forcing the second one takes a `vars`-mapped symbol in the integrand
 * (the vars contract forbids folding a live runtime input into a baked closed
 * form) or an integrand with no elementary antiderivative.
 *
 * Expected values are not recalled: each numeric case compares the enclosure
 * against the INTERPRETER's `.N()` of the very same expression.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { integrate } from '../../src/compute-engine/interval/integrate';
import type {
  Interval,
  IntervalResult,
} from '../../src/compute-engine/interval/types';

const ce = new ComputeEngine();

/** What a compiled interval runner hands back. */
type IntervalRun = IntervalResult | Interval;

/** The result kind, treating a bare `{lo, hi}` as an ordinary interval. */
function kindOf(r: IntervalRun): string {
  return 'kind' in r ? r.kind : 'interval';
}

/**
 * The enclosure carried by a run result. Throws — rather than returning a
 * placeholder that a `contains` assertion would silently pass — when the result
 * is one of the kinds that carries no interval at all.
 */
function enclosureOf(r: IntervalRun): Interval {
  if (!('kind' in r)) return r;
  if (r.kind === 'interval' || r.kind === 'partial') return r.value;
  throw new Error(`expected an enclosure, got kind '${r.kind}'`);
}

function contains(r: IntervalRun, v: number): boolean {
  const iv = enclosureOf(r);
  return iv.lo <= v && v <= iv.hi;
}

/**
 * Whether the enclosure contains `v` allowing a last-bit slack.
 *
 * The interval library does not round outward anywhere, so a DEGENERATE
 * enclosure — what the closed-form path produces from point inputs — is just a
 * double-precision evaluation of the closed form, and can sit an ulp away from
 * the interpreter's higher-precision `.N()` of the same integral (`1 − cos 1`
 * is 0.45969769413186023 compiled, 0.45969769413186035 interpreted). The slack
 * is for that gap only: every enclosure-emitter case below is orders of
 * magnitude wider and uses the strict `contains`.
 */
function containsWithin(r: IntervalRun, v: number, tol = 1e-14): boolean {
  const iv = enclosureOf(r);
  return iv.lo - tol <= v && v <= iv.hi + tol;
}

function widthOf(r: IntervalRun): number {
  const iv = enclosureOf(r);
  return iv.hi - iv.lo;
}

/** The interpreter's floating-point value for the same expression. */
function reference(latex: string): number {
  return ce.parse(latex).N().re;
}

function compileInterval(
  latex: string,
  vars?: Record<string, string>
): {
  code: string;
  run: (args?: Record<string, unknown>) => IntervalRun;
} {
  const r = compile(ce.parse(latex), { to: 'interval-js', vars });
  expect(r.success).toBe(true);
  return {
    code: String(r.code),
    run: (args = {}) => r.run!(args) as IntervalRun,
  };
}

describe('COMPILE interval-js Integrate — antiderivative-first', () => {
  test('∫₀ˣ t dt compiles to its closed form, with no partition error', () => {
    const r = compileInterval('\\int_0^x t\\,dt');
    expect(r.code).toContain('_IA.integrateClosed(');
    expect(r.code).not.toContain('_IA.integrate(');

    // x²/2 at x = 2 is 2 exactly, and the closed form is a point expression in
    // a point input, so the enclosure is degenerate — no quadrature slack.
    const out = r.run({ x: { lo: 2, hi: 2 } });
    expect(kindOf(out)).toBe('interval');
    expect(contains(out, 2)).toBe(true);
    expect(widthOf(out)).toBe(0);
  });

  test('∫₀ˣ sin t dt at a point matches the interpreter', () => {
    const r = compileInterval('\\int_0^x \\sin t\\,dt');
    expect(r.code).toContain('_IA.integrateClosed(');
    expect(r.code).not.toContain('_IA.integrate(');

    const expected = reference('\\int_0^1 \\sin t\\,dt'); // 1 − cos 1
    const out = r.run({ x: { lo: 1, hi: 1 } });
    expect(containsWithin(out, expected)).toBe(true);
    expect(widthOf(out)).toBe(0);
  });

  test('∫₀ˣ sin t dt over a WIDE x encloses the whole range of values', () => {
    const r = compileInterval('\\int_0^x \\sin t\\,dt');

    // The closed form 1 − cos x is monotone on [1, 1.1], so the true integral
    // sweeps from 1 − cos 1 to 1 − cos 1.1 as x sweeps the input interval; the
    // enclosure must contain both endpoints.
    const atLo = reference('\\int_0^1 \\sin t\\,dt');
    const atHi = reference('\\int_0^{1.1} \\sin t\\,dt');
    const out = r.run({ x: { lo: 1, hi: 1.1 } });
    expect(kindOf(out)).toBe('interval');
    expect(containsWithin(out, atLo)).toBe(true);
    expect(containsWithin(out, atHi)).toBe(true);
  });

  test('a `vars`-mapped symbol skips the fold and keeps the enclosure emitter', () => {
    // Mirrors the JavaScript target's `vars`-gate test: the same integral
    // WITHOUT the mapping folds to k²/2, proving the gate is what forces the
    // enclosure path.
    const withVars = compileInterval('\\int_0^k t\\,dt', { k: '_.k' });
    expect(withVars.code).toContain('_IA.integrate(');
    const out = withVars.run({ k: { lo: 4, hi: 4 } });
    expect(contains(out, 8)).toBe(true); // k²/2

    const noVars = compileInterval('\\int_0^k t\\,dt');
    expect(noVars.code).toContain('_IA.integrateClosed(');
    expect(noVars.code).not.toContain('_IA.integrate(');
    const folded = noVars.run({ k: { lo: 4, hi: 4 } });
    expect(contains(folded, 8)).toBe(true);
    expect(widthOf(folded)).toBe(0);
  });
});

describe('COMPILE interval-js Integrate — enclosure emitter', () => {
  test('∫₀¹ e^{−t²x} dt encloses the interpreter value tightly', () => {
    const r = compileInterval('\\int_0^1 e^{-t^2 x}\\,dt');
    expect(r.code).toContain('_IA.integrate(');

    const expected = reference('\\int_0^1 e^{-t^2}\\,dt'); // x = 1 → 0.746824…
    const out = r.run({ x: { lo: 1, hi: 1 } });
    expect(kindOf(out)).toBe('interval');
    expect(contains(out, expected)).toBe(true);
    // First-order in the partition step (see INTERVAL_QUADRATURE_SUBDIVISIONS):
    // ~2.5e-3 here. The bound is loose on purpose — it pins the ORDER of the
    // enclosure, not the exact partition count.
    expect(widthOf(out)).toBeLessThan(0.02);
  });

  test('reversed bounds give the negated enclosure', () => {
    const forward = compileInterval('\\int_0^1 a e^{-t^2}\\,dt', { a: '_.a' });
    const reversed = compileInterval('\\int_1^0 a e^{-t^2}\\,dt', { a: '_.a' });
    expect(reversed.code).toContain('_IA.integrate(');

    const f = enclosureOf(forward.run({ a: 1 }));
    const b = enclosureOf(reversed.run({ a: 1 }));
    expect(b.lo).toBe(-f.hi);
    expect(b.hi).toBe(-f.lo);
    expect(
      contains(reversed.run({ a: 1 }), -reference('\\int_0^1 e^{-t^2}\\,dt'))
    ).toBe(true);
  });

  test('a WIDE lower bound encloses every integral in the bound range', () => {
    // ∫_c^1 e^{−t²} dt with c ∈ [0, 0.5]: the true value sweeps the whole
    // range between ∫₀¹ and ∫_{0.5}^1 as c sweeps its interval.
    const r = compileInterval('\\int_c^1 a e^{-t^2}\\,dt', { a: '_.a' });
    expect(r.code).toContain('_IA.integrate(');

    const atZero = reference('\\int_0^1 e^{-t^2}\\,dt');
    const atHalf = reference('\\int_{0.5}^1 e^{-t^2}\\,dt');
    const out = r.run({ a: 1, c: { lo: 0, hi: 0.5 } });
    expect(kindOf(out)).toBe('interval');
    expect(contains(out, atZero)).toBe(true);
    expect(contains(out, atHalf)).toBe(true);
    // The correction term for a wide bound is (bound width)·(f's hull there),
    // so the enclosure is necessarily about that wide — this is the price of
    // an interval-valued bound, not a partition artifact.
    expect(widthOf(out)).toBeLessThan(0.75);
  });

  test('a nested double integral encloses the interpreter value', () => {
    // e^{−xy²} has no elementary antiderivative in y that the engine closes,
    // so BOTH levels reach the enclosure emitter — asserted, not assumed.
    const latex = '\\int_0^1\\int_0^1 e^{-x y^2}\\,dy\\,dx';
    const r = compileInterval(latex);
    expect(r.code.match(/_IA\.integrate\(/g)?.length).toBe(2);

    const expected = reference(latex);
    const out = r.run({});
    expect(kindOf(out)).toBe('interval');
    expect(contains(out, expected)).toBe(true);
    expect(widthOf(out)).toBeLessThan(0.02);
  });
});

describe('COMPILE interval-js Integrate — non-interval outcomes', () => {
  test('a pole inside the range reports `singular`', () => {
    // ∫₋₁¹ dt/t diverges. `_IA.div` reports `singular` only for a subinterval
    // that STRICTLY contains the pole and `partial` with an infinite bound when
    // the pole lands on a partition endpoint (it does here: 0 is a partition
    // point of [−1, 1]). The accumulated enclosure is non-finite either way,
    // and over a FINITE range that can only mean an unbounded integrand — so
    // the answer is `singular` regardless of where the partition falls.
    const r = compileInterval('\\int_{-1}^{1} \\frac{a}{t}\\,dt', {
      a: '_.a',
    });
    expect(r.code).toContain('_IA.integrate(');
    expect(kindOf(r.run({ a: 1 }))).toBe('singular');
  });

  test('a pole strictly inside a subinterval also reports `singular`', () => {
    // Same integrand, a range whose partition does NOT put an endpoint on the
    // pole — the `_IA.div` `singular` path rather than the infinite-bound one.
    const r = compileInterval('\\int_{-1}^{2} \\frac{a}{t}\\,dt', {
      a: '_.a',
    });
    expect(kindOf(r.run({ a: 1 }))).toBe('singular');
  });

  test('an integrand undefined on the range reports `empty`', () => {
    // ln t is undefined for t < 0, so no part of [−2, −1] is in its domain.
    const r = compileInterval('\\int_{-2}^{-1} a\\ln(t)\\,dt', { a: '_.a' });
    expect(r.code).toContain('_IA.integrate(');
    expect(kindOf(r.run({ a: 1 }))).toBe('empty');
  });

  test('an infinite bound reports `entire` — no finite partition exists', () => {
    const r = compileInterval('\\int_0^\\infty a e^{-t^2}\\,dt', {
      a: '_.a',
    });
    expect(r.code).toContain('_IA.integrate(');
    expect(kindOf(r.run({ a: 1 }))).toBe('entire');
  });
});

describe('COMPILE interval-js Integrate — indefinite fails closed', () => {
  test('∫ e^{x³} sin(x) dx declines instead of fabricating a value', () => {
    // An indefinite integral with no closed-form antiderivative denotes a
    // FUNCTION, not a number. Its `Limits` bounds are the `Nothing` symbol; the
    // enclosure emitter would compile those like any free symbol, to a
    // vars-object lookup (`_.Nothing`) that reads `undefined` at run time.
    const r = compile(ce.parse('\\int e^{x^3}\\sin(x) dx'), {
      to: 'interval-js',
    });
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Fail closed \(D6\)/);
    expect(r.error).toMatch(/indefinite integral/);
    expect(String(r.code ?? '')).not.toContain('_.Nothing');
  });

  test('an indefinite integral WITH a closed form still compiles', () => {
    const r = compileInterval('\\int x^2 dx');
    // No range to scan: the closed form is emitted bare, as a function of
    // its free bound, with no `_IA.integrateClosed` guard.
    expect(r.code).not.toContain('_IA.integrate');
    const out = r.run({ x: { lo: 3, hi: 3 } });
    expect(contains(out, 9)).toBe(true); // x³/3 at x = 3
  });
});

describe('COMPILE interval-js Integrate — review hardening', () => {
  const ce = new ComputeEngine();

  test('∫₋₁¹ dt/t² reports `singular` — no closed form is trusted over an interior pole', () => {
    // Two independent defenses: the `Integrate` evaluate handler keeps an
    // integral with a proven interior pole inert (`integrandHasInteriorPole`),
    // so no closed form reaches this target; and were one to reach it, the
    // run-time scan in `_IA.integrateClosed` would withhold it (pinned at the
    // runtime level in `interval-arithmetic.test.ts`). Either way the
    // enclosure path answers `singular`.
    const r = compile(
      ce.box([
        'Integrate',
        ['Divide', 1, ['Square', 't']],
        ['Limits', 't', -1, 1],
      ]),
      { to: 'interval-js' }
    );
    expect(r.success).toBe(true);
    expect(r.run!({})).toEqual({ kind: 'singular' });
  });

  test('a clean closed form still answers the closed value through the guard', () => {
    const r = compile(
      ce.box(['Integrate', ['Square', 't'], ['Limits', 't', 0, 'x']]),
      { to: 'interval-js' }
    );
    expect(r.success).toBe(true);
    const v = r.run!({ x: 3 }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(v.kind).toBe('interval');
    expect(v.value.lo).toBeCloseTo(9, 12);
    expect(v.value.hi).toBeCloseTo(9, 12);
  });

  test('nested limits share one evaluation budget: a triple integral gets 40 pieces per level', () => {
    const r = compile(
      ce.box([
        'Integrate',
        ['Multiply', 'a', 'x', 'y', 'z'],
        ['Limits', 'x', 0, 1],
        ['Limits', 'y', 0, 1],
        ['Limits', 'z', 0, 1],
      ]),
      { to: 'interval-js', vars: { a: '_.a' } }
    );
    expect(r.success).toBe(true);
    expect((r.code.match(/, 40\)/g) ?? []).length).toBe(3);
    const v = r.run!({ a: 1 }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(v.kind).toBe('interval');
    expect(v.value.lo).toBeLessThanOrEqual(0.125);
    expect(v.value.hi).toBeGreaterThanOrEqual(0.125);
  });

  test('a `Function` integrand is paired to the limits BY NAME, as the interpreter does', () => {
    // ∫₀¹∫₀² a·x·y² dy dx = a·(1/2)·(8/3) = 4a/3. Positional pairing would
    // bind the lambda named `y` to x's range and compute ∫∫ a·y·x² = 2a/3.
    const r = compile(
      ce.box([
        'Integrate',
        ['Function', ['Multiply', 'a', 'x', ['Square', 'y']], 'y', 'x'],
        ['Limits', 'x', 0, 1],
        ['Limits', 'y', 0, 2],
      ]),
      { to: 'interval-js', vars: { a: '_.a' } }
    );
    expect(r.success).toBe(true);
    const v = r.run!({ a: 1 }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(v.kind).toBe('interval');
    expect(v.value.lo).toBeLessThanOrEqual(4 / 3);
    expect(v.value.hi).toBeGreaterThanOrEqual(4 / 3);
    expect(v.value.hi - v.value.lo).toBeLessThan(0.05);
  });

  test('a `Function` integrand with a spare parameter fails closed', () => {
    const r = compile(
      ce.box([
        'Integrate',
        ['Function', ['Add', 'x', 'q'], 'x', 'q'],
        ['Limits', 'x', 0, 1],
      ]),
      { to: 'interval-js', vars: { q: '_.q' } }
    );
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('one to one');
  });

  test('the accumulation is widened for its own rounding: a constant integrand encloses the exact value', () => {
    // 0.1 is not a double; 1000 products and sums of it would otherwise
    // round the exact ∫₀¹ 0.1 dt = 0.1 out of a zero-width result.
    const r = compile(
      ce.box(['Integrate', ['Multiply', 'a', 0.1], ['Limits', 't', 0, 1]]),
      { to: 'interval-js', vars: { a: '_.a' } }
    );
    expect(r.success).toBe(true);
    const v = r.run!({ a: 1 }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(v.kind).toBe('interval');
    expect(v.value.lo).toBeLessThanOrEqual(0.1);
    expect(v.value.hi).toBeGreaterThanOrEqual(0.1);
    expect(v.value.hi - v.value.lo).toBeLessThan(1e-12);
  });
});

describe('COMPILE interval-js Integrate — collection body and bounds fail closed', () => {
  const ce = new ComputeEngine();
  ce.declare('Lb', 'list<number>');

  test('a collection-valued body declines', () => {
    // `2·Lb`, not the bare symbol: inside the integral's own scope a free
    // symbol types `unknown` (its outer declaration is not visible there),
    // so only a body whose collection-ness is provable from its structure
    // is gated at compile time. A bare collection symbol reaching the
    // enclosure at run time answers `entire` (`propagatedKind`).
    const r = compile(
      ce.box(['Integrate', ['Multiply', 2, 'Lb'], ['Limits', 't', 0, 1]]),
      { to: 'interval-js' }
    );
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('collection-valued body');
  });

  test('a collection-valued bound declines', () => {
    const r = compile(ce.box(['Integrate', 't', ['Limits', 't', 0, 'Lb']]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(false);
    expect(String(r.error)).toContain('is a collection');
  });
});

describe('INTERVAL INTEGRATE runtime — a non-interval integrand value cannot be bounded', () => {
  test('an array from the integrand answers `entire`', () => {
    const r = integrate(
      () => [{ lo: 1, hi: 1 }] as never,
      { lo: 0, hi: 0 },
      {
        lo: 1,
        hi: 1,
      }
    );
    expect(r).toEqual({ kind: 'entire' });
  });
});
