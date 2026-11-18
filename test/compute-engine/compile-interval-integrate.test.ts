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
 * Forcing the second one takes a `vars`-mapped symbol in the integrand whose
 * mapping is not a plain read (`(_.a)`: the closed form is attempted only when
 * every mapped symbol it reaches is a valueless plain read such as `_.a`) or
 * an integrand with no elementary antiderivative.
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
ce.declare('c', 'real');
ce.declare('x', 'real');

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
 * The closed-form path evaluates in double precision and rounds each endpoint
 * it cannot prove exact one ulp outward, which is a few ulps wide in all. The
 * interpreter's `.N()` of the same integral works at higher precision, so the
 * two can differ by more than that narrow enclosure covers when the closed
 * form loses digits to cancellation. The slack is for that gap only: every
 * enclosure-emitter case below is orders of magnitude wider and uses the
 * strict `contains`.
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
    // `cos 1` is irrational: the enclosure is the outward-rounded
    // neighbourhood of the closed form, a few ulps wide, and it contains the
    // interpreter's value exactly because it rounds outward.
    expect(contains(out, expected)).toBe(true);
    expect(widthOf(out)).toBeLessThan(1e-15);
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
    expect(r.error).toMatch(/Could not compile/);
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
    expect(r.diagnostic?.code).toBe('outside-profile');
    expect(r.diagnostic?.operator).toBe('Integrate');
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
    expect(r.diagnostic?.code).toBe('outside-profile');
    expect(r.diagnostic?.value).toBe('Block(Multiply(2, "Lb"))');
  });

  test('a collection-valued bound declines', () => {
    const r = compile(ce.box(['Integrate', 't', ['Limits', 't', 0, 'Lb']]), {
      to: 'interval-js',
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('outside-profile');
    expect(r.diagnostic?.value).toBe('"Lb"');
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

describe('INTERVAL INTEGRATE — dynamic nesting: compile-time sizing and the runtime budget (Tycho item 226)', () => {
  // An inner integral runs once per enclosing piece, so composition
  // multiplies work per level — the Tycho item-226 witness macro-expanded a
  // six-level Newton iteration into 728 integrals nested inside each
  // other's integrands (~256^6 integrand evaluations; it never returned).
  // Two mechanisms bound this, split by what each can see:
  //
  // - nesting VISIBLE in the tree (`Integrate` nodes inside each other's
  //   integrands or bounds) is sized at COMPILE time: the outermost node
  //   measures its subtree (`integrateStats`) and picks one uniform piece
  //   count within the budget, or DECLINES (fail closed) when fewer than 4
  //   pieces per level would remain — an enclosure that coarse is as
  //   uninformative as `entire` at full cost;
  // - nesting through BY-REFERENCE function calls (`∫ g(x) dx` where `g`'s
  //   body computes an integral) shows no `Integrate` node in the tree, so
  //   the runtime budget (`INTERVAL_NESTED_QUADRATURE_BUDGET`,
  //   `interval/integrate.ts`) cuts nested work off and answers `entire` —
  //   sound (the entire line contains the true value), and the caller
  //   degrades to its non-interval fallback instead of spinning.

  /** A dynamically nested chain of `depth` integrals, each inner one inside
   *  the enclosing integrand: ∫₀¹ sin(x₁ + ∫₀¹ sin(x₂ + …) dx₂) dx₁, with
   *  `inner` as the innermost integrand term. */
  function chain(depth: number, inner: string): string {
    let src = inner;
    for (let d = 1; d <= depth; d++)
      src = `\\int_0^1 \\sin\\left(x_{${d}} + ${src}\\right) dx_{${d}}`;
    return src;
  }

  test('a seven-deep visible chain DECLINES: below 4 pieces per level', () => {
    // 7 integral runs, 7 levels → ⌊(65536/7)^(1/7)⌋ = 3 < 4. An enclosure that
    // coarse is as uninformative as `entire` while still costing the whole
    // budget, so the compile fails closed and the caller falls back (a
    // two-lane consumer uses its scalar estimate).
    const res = compile(ce.parse(chain(7, 'x_{0}')), {
      to: 'interval-js',
      vars: { x_0: '_.x_0' },
    });
    expect(res.success).toBe(false);
  }, 30000);
});
