/**
 * Four findings of the Tycho code-generation audit against the `interval-js`
 * target, and the emission each one now produces.
 *
 * 1. `Arg` declined. The phase of a complex value built in the expression is
 *    `atan2` of its two REAL parts, which the interval domain does have.
 * 2. A constant interval written once inside a USER-FUNCTION body stayed an
 *    inline object literal, allocated on every call of that function — and a
 *    function called from an unrolled sum is called many times per
 *    evaluation.
 * 3. A product by a constant POINT ran the four-product general multiply.
 * 4. A constant factor and an exact rational divisor were two run-time
 *    operations (`mul` then `div`) where one folded enclosure does.
 *
 * Every enclosure this file checks must CONTAIN the real value: that is the
 * guarantee the target answers with, and a faster or tighter emission that
 * loses it is worse than no emission.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  compileDiagnosticOf,
  isCompileDeclineError,
} from '../../src/compute-engine/compilation/diagnostics';
import { IntervalArithmetic as IA } from '../../src/compute-engine/interval';

type Enclosure = { lo: number; hi: number };
type IntervalRun = {
  success: boolean;
  code: string;
  preamble?: string;
  error?: string;
  run: (arg: unknown) => unknown;
};

function compileInterval(expr: unknown): IntervalRun {
  return compile(expr as never, {
    to: 'interval-js',
    fallback: false,
  }) as unknown as IntervalRun;
}

/** The enclosure of a run's answer, whatever kind it carries. */
function boundOf(v: unknown): Enclosure {
  const r = v as { value?: Enclosure } & Enclosure;
  return r.value ?? r;
}

function point(x: number): Enclosure {
  return { lo: x, hi: x };
}

describe('interval-js: the argument (phase) of a complex value', () => {
  test('an opaque complex operand fails closed', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    // The interval mode declines the complex input: it has no complex lane.
    let error: unknown;
    try {
      compileInterval(ce.parse('\\arg(\\sin(z))'));
    } catch (e) {
      error = e;
    }
    expect(isCompileDeclineError(error)).toBe(true);
    expect(compileDiagnosticOf(error).code).toBe('outside-profile');
  });
});

describe('interval-js: constants of a user-function body are hoisted', () => {
  function engineWithF(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) -> number');
    ce.assign('f', ce.parse('t \\mapsto 2t + \\frac{t}{3} + \\frac{1}{2}'));
    return ce;
  }

  test('a constant written once in a LOOP body', () => {
    // 200 terms exceed the unroll limit, so a loop is emitted and its body
    // runs once per iteration.
    const ce = new ComputeEngine();
    const expr = ce.parse('\\sum_{n=1}^{200} \\sin(n x + 0.3)');
    const r = compileInterval(expr);
    expect(r.success).toBe(true);
    for (const x of [0.7, -1.3]) {
      const interpreted = expr.subs({ x }).N().re;
      const got = boundOf(r.run({ x: point(x) }));
      expect(got.lo).toBeLessThanOrEqual(interpreted);
      expect(got.hi).toBeGreaterThanOrEqual(interpreted);
    }
    const box = boundOf(r.run({ x: { lo: 0.7, hi: 0.7001 } }));
    for (const x of [0.7, 0.70005, 0.7001]) {
      const interpreted = expr.subs({ x }).N().re;
      expect(box.lo).toBeLessThanOrEqual(interpreted);
      expect(box.hi).toBeGreaterThanOrEqual(interpreted);
    }
  });

  test('the hoisted body answers what the inline body answered', () => {
    const ce = engineWithF();
    const r = compileInterval(ce.box(['Add', ['f', 'x'], ['f', 'y']]));
    const got = boundOf(r.run({ x: point(3), y: point(6) }));
    // f(3) + f(6) = (6 + 1 + 0.5) + (12 + 2 + 0.5) = 22
    expect(got.lo).toBeLessThanOrEqual(22);
    expect(got.hi).toBeGreaterThanOrEqual(22);
    expect(got.hi - got.lo).toBeLessThan(1e-12);
  });
});

describe('interval-js: a constant point factor scales instead of multiplying', () => {
  test('an INEXACT constant keeps the general product', () => {
    // `π` is a two-ulp enclosure, not a point, so there is nothing to
    // specialize and the four endpoint products are all needed.
    const ce = new ComputeEngine();
    expect(compileInterval(ce.parse('\\pi \\sin(x)')).code).toContain(
      '_IA.mul('
    );
  });

  test('the kernels answer exactly what mul and div answer', () => {
    const values = [
      0, -0, 1, -1, 0.5, -0.5, 3, 49, 1e308, 5e-324, Infinity, -Infinity,
      Math.PI,
    ];
    for (const c of values) {
      for (const lo of values) {
        for (const hi of values) {
          if (!(lo <= hi)) continue;
          const p = point(c);
          const b = { lo, hi };
          expect(IA.scale(p, b)).toEqual(IA.mul(p, b));
          expect(IA.scaleDiv(b, p)).toEqual(IA.div(b, p));
        }
      }
    }
  });

  test('an operand that is not a point falls back to the general kernel', () => {
    const wide = { lo: -1, hi: 2 };
    expect(IA.scale(wide, { lo: 3, hi: 4 })).toEqual(
      IA.mul(wide, { lo: 3, hi: 4 })
    );
    // A zero or zero-straddling divisor keeps every answer of the general
    // division: `empty`, `singular`, `partial` and `entire`.
    expect(IA.scaleDiv({ lo: 1, hi: 2 }, { lo: 0, hi: 0 })).toEqual({
      kind: 'empty',
    });
    expect(IA.scaleDiv({ lo: 1, hi: 2 }, { lo: -1, hi: 1 })).toEqual({
      kind: 'singular',
    });
  });

  test('the scaled quotient is still exact at a multiple of the divisor', () => {
    const ce = new ComputeEngine();
    const r = compileInterval(ce.parse('\\lfloor\\frac{3x}{49}\\rfloor'));
    for (let k = 1; k <= 40; k++)
      expect(boundOf(r.run({ x: point(49 * k) }))).toEqual(point(3 * k));
  });
});

describe('interval-js: a constant chain folds into one enclosure', () => {
  test('`2πs/100` is one multiplication by an enclosure of π/50', () => {
    const ce = new ComputeEngine();
    const r = compileInterval(ce.parse('\\frac{2\\pi s}{100}'));
    expect(r.code).not.toContain('_IA.div(');
  });

  test('the folded enclosure contains the high-precision value of π/50', () => {
    // The engine's own 50-digit value: 0.0628318530717958647692528676655…
    const hce = new ComputeEngine();
    hce.precision = 50;
    const truth = hce.parse('\\frac{\\pi}{50}');
    const gap = (endpoint: number): number =>
      hce.box(['Subtract', truth, hce.number(endpoint)]).N().re;
    expect(gap(0.06283185307179584)).toBeGreaterThan(0);
    expect(gap(0.06283185307179588)).toBeLessThan(0);
  });

  test('the folded product answers the true value at a point', () => {
    const ce = new ComputeEngine();
    const r = compileInterval(ce.parse('\\frac{2\\pi s}{100}'));
    for (const s of [1, 3.5, -2, 100]) {
      const got = boundOf(r.run({ s: point(s) }));
      const truth = (2 * Math.PI * s) / 100;
      expect(got.lo).toBeLessThanOrEqual(truth);
      expect(got.hi).toBeGreaterThanOrEqual(truth);
    }
  });

  test('an EXACT constant factor does not absorb the rational divisor', () => {
    // `2x/49` is exactly `2k` at `x = 49k` because the division is exact
    // there. A folded `2/49` — no double holds that value — would answer an
    // interval around `2k` instead, and `floor` would read a discontinuity.
    const ce = new ComputeEngine();
    const floored = compileInterval(ce.parse('\\lfloor\\frac{2x}{49}\\rfloor'));
    for (let k = 1; k <= 40; k++)
      expect(boundOf(floored.run({ x: point(49 * k) }))).toEqual(point(2 * k));
  });
});
