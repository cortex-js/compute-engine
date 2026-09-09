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
  test('a value built as `a + i·b` compiles to atan2 of its real parts', () => {
    const ce = new ComputeEngine();
    const r = compileInterval(
      ce.parse('\\arg((x-0.3127)+\\imaginaryI(y-0.329))')
    );
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '_IA.atan2(_IA.add(_.y, _IA.point(-0.329)), _IA.add(_.x, _IA.point(-0.3127)))'
    );
  });

  test('the enclosure contains the interpreter value at a point', () => {
    const ce = new ComputeEngine();
    const r = compileInterval(
      ce.parse('\\arg((x-0.3127)+\\imaginaryI(y-0.329))')
    );
    for (const [x, y] of [
      [0.5, 0.4],
      [0.1, 0.1],
      [0.3127, 0.9],
      [-1, 0.329],
      [0.2, 0.2],
    ]) {
      const interpreted = ce
        .box(['Argument', ['Complex', x - 0.3127, y - 0.329]])
        .N().re;
      const got = boundOf(r.run({ x: point(x), y: point(y) }));
      expect(got.lo).toBeLessThanOrEqual(interpreted);
      expect(got.hi).toBeGreaterThanOrEqual(interpreted);
    }
  });

  test('a box across the branch cut answers the hull [−π, π] as a jump', () => {
    const ce = new ComputeEngine();
    const r = compileInterval(ce.parse('\\arg(x+\\imaginaryI y)'));
    expect(r.code).toBe('_IA.atan2(_.y, _.x)');
    const cut = r.run({
      x: { lo: -1, hi: -0.5 },
      y: { lo: -0.25, hi: 0.25 },
    }) as { kind: string } & { value: Enclosure };
    // Every value the phase takes on that box lies in the hull, and the jump
    // across the negative real axis is reported rather than smoothed over.
    expect(cut.kind).toBe('singular');
    expect(cut.value.lo).toBeLessThanOrEqual(-Math.PI);
    expect(cut.value.hi).toBeGreaterThanOrEqual(Math.PI);
  });

  test('a real operand is the same call with a zero imaginary part', () => {
    const ce = new ComputeEngine();
    const r = compileInterval(ce.parse('\\arg(x)'));
    expect(r.code).toBe('_IA.atan2(_IA.point(0), _.x)');
    expect(boundOf(r.run({ x: point(2) })).hi).toBeCloseTo(0, 15);
    const negative = boundOf(r.run({ x: point(-2) }));
    expect(negative.lo).toBeLessThanOrEqual(Math.PI);
    expect(negative.hi).toBeGreaterThanOrEqual(Math.PI);
  });

  test('an opaque complex operand fails closed', () => {
    const ce = new ComputeEngine();
    ce.declare('z', 'complex');
    const r = compileInterval(ce.parse('\\arg(\\sin(z))'));
    expect(r.success).toBe(false);
    expect(r.error).toContain('Argument');
    expect(r.error).toContain('D6');
  });
});

describe('interval-js: constants of a user-function body are hoisted', () => {
  function engineWithF(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('f', '(number) -> number');
    ce.assign('f', ce.parse('t \\mapsto 2t + \\frac{t}{3} + \\frac{1}{2}'));
    return ce;
  }

  test('a constant written once in a body becomes a preamble local', () => {
    const ce = engineWithF();
    const r = compileInterval(ce.box(['Add', ['f', 'x'], ['f', 'y']]));
    expect(r.success).toBe(true);
    // The body allocates no interval object of its own: `2`, `3` and `0.5`
    // each occur once in it and are each bound in the preamble.
    const body = r.preamble!.slice(r.preamble!.indexOf('const _fn_f'));
    expect(body).not.toContain('_IA.point(');
    expect(body).not.toContain('{ lo:');
    for (const decl of ['_IA.point(2)', '_IA.point(3)', '_IA.point(0.5)'])
      expect(r.preamble).toContain(`= ${decl};`);
  });

  test('a constant written once in the ROOT expression is left inline', () => {
    // The root runs once per call, so a name would save no allocation.
    const ce = new ComputeEngine();
    const r = compileInterval(ce.parse('x + 7'));
    expect(r.code).toBe('_IA.add(_.x, _IA.point(7))');
    expect(r.preamble ?? '').toBe('');
  });

  test('a constant written once in a LOOP body becomes a preamble local', () => {
    // 200 terms exceed the unroll limit, so a loop is emitted and its body
    // runs once per iteration.
    const ce = new ComputeEngine();
    const r = compileInterval(ce.parse('\\sum_{n=1}^{200} \\sin(n x + 0.3)'));
    expect(r.preamble).toContain('= _IA.point(0.3);');
    const loop = r.code.slice(r.code.indexOf('for ('));
    expect(loop).not.toContain('_IA.point(0.3)');
    // The point over the loop INDEX is not a constant and stays where it is.
    expect(loop).toContain('_IA.point(n)');
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
  test('a literal point factor emits the scaling kernel', () => {
    const ce = new ComputeEngine();
    expect(compileInterval(ce.parse('0.5x')).code).toBe(
      '_IA.scale(_IA.point(0.5), _.x)'
    );
    // The point is written first even when it is the right-hand factor:
    // interval multiplication is commutative endpoint for endpoint.
    expect(compileInterval(ce.parse('\\sin(x) \\cdot 3')).code).toBe(
      '_IA.scale(_IA.point(3), _IA.sin(_.x))'
    );
    // A constant divisor divides through the matching kernel.
    expect(compileInterval(ce.parse('\\frac{\\sin(x)}{1.6}')).code).toBe(
      '_IA.scaleDiv(_IA.sin(_.x), _IA.point(1.6))'
    );
  });

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
    expect(r.code).toBe(
      "_IA.mul({ kind: 'interval', value: { lo: 0.06283185307179584, " +
        'hi: 0.06283185307179588 } }, _.s)'
    );
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
    const r = compileInterval(ce.parse('\\frac{2x}{49}'));
    expect(r.code).toContain('_IA.scaleDiv(_.x, _IA.point(49))');
    const floored = compileInterval(ce.parse('\\lfloor\\frac{2x}{49}\\rfloor'));
    for (let k = 1; k <= 40; k++)
      expect(boundOf(floored.run({ x: point(49 * k) }))).toEqual(point(2 * k));
  });
});
