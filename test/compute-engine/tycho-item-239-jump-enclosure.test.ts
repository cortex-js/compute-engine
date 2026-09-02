/**
 * Tycho item 239 — a JUMP discontinuity carries its enclosure.
 *
 * The interval kernel reported every discontinuity as `{ kind: 'singular' }`,
 * whether the function was unbounded there (`1/x` across 0 — a pole) or
 * merely not continuous (`floor(x)` across an integer — a finite jump). A
 * consumer that only needs a bound — an implicit-curve sign test — could then
 * do nothing with a jump but treat it like a pole and cull the cell, which
 * blanked 38 % of `mod(100/r², 6.3) = 3` (Tycho `D-267`).
 *
 * Contract pinned here (`src/compute-engine/interval/types.ts`):
 * - a jump is `singular` WITH `value`, a sound finite enclosure of the
 *   function over the input; `at` / `continuity` are kept;
 * - a pole is `singular` WITHOUT `value`;
 * - every operation propagates a jump: it computes over the enclosure and
 *   re-tags its bounded result as the same jump (`liftJump`, `util.ts`); an
 *   unbounded result degrades to a pole;
 * - comparisons, `unionResults` and `integrate` use the enclosure.
 *
 * Also pinned: the step functions propagate a NaN input as a NaN interval
 * (they answered a discontinuity "at NaN" before).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { IntervalArithmetic as IA } from '../../src/compute-engine/interval';
import type {
  Interval,
  IntervalResult,
} from '../../src/compute-engine/interval';

const iv = (lo: number, hi: number): Interval => ({ lo, hi });

/** The result as a jump: fails the test for any other kind. */
function asJump(r: IntervalResult): {
  at?: number;
  continuity?: 'left' | 'right';
  value: Interval;
} {
  expect(r.kind).toBe('singular');
  if (r.kind !== 'singular') throw new Error('unreachable');
  expect(r.value).toBeDefined();
  return { at: r.at, continuity: r.continuity, value: r.value! };
}

function expectPole(r: IntervalResult): void {
  expect(r.kind).toBe('singular');
  if (r.kind === 'singular') expect(r.value).toBeUndefined();
}

describe('Interval jump enclosure — the step functions carry a bound', () => {
  test('floor across an integer: [floor(lo), floor(hi)], right-continuous', () => {
    const j = asJump(IA.floor(iv(0.5, 2.5)));
    expect(j).toEqual({ at: 1, continuity: 'right', value: iv(0, 2) });
  });

  test('ceil across an integer: [ceil(lo), ceil(hi)], left-continuous', () => {
    const j = asJump(IA.ceil(iv(0.5, 2.5)));
    expect(j).toEqual({ at: 1, continuity: 'left', value: iv(1, 3) });
  });

  test('round across a half-integer', () => {
    expect(asJump(IA.round(iv(2.4, 2.6)))).toEqual({
      at: 2.5,
      continuity: 'right',
      value: iv(2, 3),
    });
    // Half away from zero: the jump at -2.5 belongs to the left.
    expect(asJump(IA.round(iv(-2.6, -2.4))).value).toEqual(iv(-3, -2));
  });

  test('fract across an integer: the whole sawtooth period [0, 1]', () => {
    expect(asJump(IA.fract(iv(0.5, 1.5))).value).toEqual(iv(0, 1));
  });

  test('trunc: monotone hull in every arm', () => {
    expect(asJump(IA.trunc(iv(0.5, 2.5))).value).toEqual(iv(0, 2));
    // `Math.trunc(-0.5)` is `-0`, and `toEqual` tells `-0` from `0`.
    expect(asJump(IA.trunc(iv(-2.5, -0.5))).value).toEqual(iv(-2, -0));
    // Spanning zero from below -1: the first jump is at -1, from the left.
    expect(asJump(IA.trunc(iv(-1.5, 1.5)))).toEqual({
      at: -1,
      continuity: 'left',
      value: iv(-1, 1),
    });
    // Spanning zero from inside (-1, 0): the first jump is at +1.
    expect(asJump(IA.trunc(iv(-0.5, 1.5)))).toEqual({
      at: 1,
      continuity: 'right',
      value: iv(-0, 1),
    });
  });

  test('mod across a period: one period of the sawtooth, by divisor sign', () => {
    // Positive divisor: values in [0, b).
    expect(asJump(IA.mod(iv(5, 8), iv(6.3, 6.3)))).toEqual({
      at: 6.3,
      continuity: 'right',
      value: iv(0, 6.3),
    });
    // Negative divisor (floored convention): values in (b, 0].
    expect(asJump(IA.mod(iv(5, 8), iv(-6.3, -6.3))).value).toEqual(iv(-6.3, 0));
    // Negative divisor with the dividend starting on a period multiple.
    expect(asJump(IA.mod(iv(-6.3, -5), iv(-6.3, -6.3))).value).toEqual(
      iv(-6.3, 0)
    );
    // A divisor straddling zero is a pole, as before.
    expectPole(IA.mod(iv(1, 2), iv(-1, 1)));
  });

  test('heaviside and sign across zero', () => {
    expect(asJump(IA.heaviside(iv(-1, 1)))).toEqual({
      at: 0,
      continuity: undefined,
      value: iv(0, 1),
    });
    expect(asJump(IA.sign(iv(-1, 1))).value).toEqual(iv(-1, 1));
  });

  test('a constant step stays a plain interval', () => {
    expect(IA.floor(iv(1.2, 1.8))).toEqual({
      kind: 'interval',
      value: iv(1, 1),
    });
    expect(IA.mod(iv(1, 2), iv(6.3, 6.3))).toEqual({
      kind: 'interval',
      value: iv(1, 2),
    });
  });

  test('a NaN input propagates as a NaN interval, not a jump at NaN', () => {
    const nan = iv(NaN, NaN);
    for (const f of [IA.floor, IA.ceil, IA.round, IA.fract, IA.trunc]) {
      const r = f(nan);
      expect(r.kind).toBe('interval');
      if (r.kind === 'interval') {
        expect(Number.isNaN(r.value.lo)).toBe(true);
        expect(Number.isNaN(r.value.hi)).toBe(true);
      }
    }
    expect(IA.mod(nan, iv(2, 2)).kind).toBe('interval');
    expect(IA.mod(iv(1, 2), nan).kind).toBe('interval');
  });

  test('an infinite input has no finite enclosure: reported as a pole', () => {
    expectPole(IA.floor(iv(-Infinity, 3)));
  });
});

describe('Interval jump enclosure — propagation through operations', () => {
  const jumpFloor = IA.floor(iv(0.5, 1.5)); // value [0, 1], at 1, right

  test('arithmetic computes over the enclosure and keeps the jump', () => {
    expect(asJump(IA.sub(jumpFloor, iv(3, 3)))).toEqual({
      at: 1,
      continuity: 'right',
      value: iv(-3, -2),
    });
    expect(asJump(IA.add(IA.mul(iv(2, 2), jumpFloor), iv(1, 1))).value).toEqual(
      iv(1, 3)
    );
    expect(asJump(IA.negate(jumpFloor)).value).toEqual(iv(-1, -0));
    expect(asJump(IA.exp(jumpFloor)).value).toEqual(iv(1, Math.E));
  });

  test('an unbounded result is returned as the operation gave it', () => {
    // 1 / floor(x) over [-0.5, 0.5]: floor takes the value 0, and `div` by
    // an interval that touches zero answers a domain-clipped `partial` with
    // an infinite bound. That is not a finite jump, so it is not re-tagged.
    const r = IA.div(iv(1, 1), IA.floor(iv(-0.5, 0.5)));
    expect(r.kind).toBe('partial');
  });

  test('a point result means the operation is constant: no jump', () => {
    expect(IA.pow(jumpFloor, 0)).toEqual({ kind: 'interval', value: iv(1, 1) });
    expect(IA.mul(jumpFloor, iv(0, 0))).toEqual({
      kind: 'interval',
      value: iv(0, 0),
    });
  });

  test('a partial result keeps its domain clip instead of the jump', () => {
    // sqrt(sign(x)) across 0: sign's enclosure [-1, 1] is clipped below.
    const r = IA.sqrt(IA.sign(iv(-1, 1)));
    expect(r).toEqual({
      kind: 'partial',
      value: iv(0, 1),
      domainClipped: 'lo',
    });
  });

  test('the earliest jump among the operands locates the result', () => {
    // floor jumps at 1 and 2 over [0.5, 2.5]; ceil at 1 and 2 with the
    // other side. Same first point, conflicting side: no continuity.
    const r = asJump(IA.add(IA.ceil(iv(0.5, 2.5)), IA.floor(iv(0.5, 2.5))));
    expect(r.at).toBe(1);
    expect(r.continuity).toBeUndefined();
    // Later-first argument order still reports the earliest jump.
    const s = asJump(IA.add(IA.floor(iv(1.5, 2.5)), IA.floor(iv(0.5, 1.5))));
    expect(s).toEqual({ at: 1, continuity: 'right', value: iv(1, 3) });
  });

  test('an absent element selected through a jump index stays absent', () => {
    // `at` answers a bare NaN interval for "no such element"; the compiled
    // target reads `.lo` off it, so it must not be re-tagged.
    const r = IA.at([], IA.floor(iv(0.5, 1.5)));
    expect('kind' in r).toBe(false);
    expect(Number.isNaN((r as Interval).lo)).toBe(true);
  });

  test('a pole operand stays a pole; empty and entire still dominate', () => {
    expectPole(IA.add(IA.div(iv(1, 1), iv(-1, 1)), jumpFloor));
    expect(IA.add(jumpFloor, { kind: 'empty' }).kind).toBe('empty');
    expect(IA.add(jumpFloor, { kind: 'entire' }).kind).toBe('entire');
  });

  test('a jump operand into a step function: the step decides', () => {
    // floor over [0, 1] is itself a jump (at 1): the inner one is reported.
    const r = asJump(IA.floor(IA.mul(iv(0.5, 0.5), IA.floor(iv(0.5, 3.5)))));
    expect(r).toEqual({ at: 1, continuity: 'right', value: iv(0, 1) });
    // floor over the enclosure [0, 0.5] is constant 0: no jump survives.
    expect(IA.floor(IA.mul(iv(0.5, 0.5), jumpFloor))).toEqual({
      kind: 'interval',
      value: iv(0, 0),
    });
  });

  test('comparisons decide on the enclosure', () => {
    expect(IA.less(jumpFloor, iv(5, 5))).toBe('true');
    expect(IA.greater(jumpFloor, iv(5, 5))).toBe('false');
    expect(IA.less(jumpFloor, iv(0.5, 0.5))).toBe('maybe');
  });

  test('piecewise: a jump in the selected branch is kept, a maybe unions', () => {
    expect(
      asJump(
        IA.piecewise(
          'true',
          () => jumpFloor,
          () => iv(7, 7)
        )
      ).value
    ).toEqual(iv(0, 1));
    expect(
      asJump(
        IA.piecewise(
          'maybe',
          () => jumpFloor,
          () => iv(7, 7)
        )
      )
    ).toEqual({ at: 1, continuity: 'right', value: iv(0, 7) });
  });

  test('unionResults: jump ∪ interval hulls; jump ∪ pole is a pole', () => {
    expect(asJump(IA.unionResults(jumpFloor, IA.ok(iv(7, 8)))).value).toEqual(
      iv(0, 8)
    );
    expectPole(IA.unionResults(jumpFloor, { kind: 'singular' }));
    expectPole(IA.unionResults({ kind: 'singular' }, { kind: 'entire' }));
    expect(IA.unionResults(jumpFloor, { kind: 'entire' }).kind).toBe('entire');
  });

  test('a jump in an integration bound is re-tagged on the integral', () => {
    // ∫ from floor(x) to 3 of 1 dt, x across 1: the bound jumps, so does
    // the integral (3 − floor(x) ∈ [2, 3]).
    const r = asJump(IA.integrate(() => iv(1, 1), jumpFloor, iv(3, 3), 8));
    expect(r.value.lo).toBeLessThanOrEqual(2);
    expect(r.value.hi).toBeGreaterThanOrEqual(3);
  });

  test('integrate over a jump is bounded: ∫₀³ floor(t) dt = 3', () => {
    const r = IA.integrate((t) => IA.floor(t), iv(0, 0), iv(3, 3), 64);
    expect(r.kind).toBe('interval');
    if (r.kind === 'interval') {
      expect(r.value.lo).toBeLessThanOrEqual(3);
      expect(r.value.hi).toBeGreaterThanOrEqual(3);
      expect(r.value.hi - r.value.lo).toBeLessThan(0.2);
    }
  });

  test('getValue / unwrap read the enclosure of a jump', () => {
    expect(IA.getValue(jumpFloor)).toEqual(iv(0, 1));
    expect(IA.unwrap(jumpFloor)).toEqual(iv(0, 1));
    expect(IA.getValue({ kind: 'singular' })).toBeUndefined();
  });
});

describe('Interval jump enclosure — the compiled interval-js route', () => {
  const ce = new ComputeEngine();
  const run = (latex: string) => {
    const r = compile(ce.parse(latex), { to: 'interval-js' });
    expect(r.success).toBe(true);
    return (args: Record<string, Interval>) => r.run!(args) as IntervalResult;
  };

  test("Tycho's witness: mod(100/r², 6.3) − 3 over a cell spanning a ring", () => {
    const f = run(
      '\\operatorname{mod}\\left(\\frac{100}{x^{2}+y^{2}},6.3\\right)-3'
    );
    // 100/r² over this cell spans about [69, 100]: one period boundary.
    const j = asJump(f({ x: iv(1, 1.2), y: iv(0, 0.1) }));
    expect(j.value).toEqual(iv(-3, 3.3));
    expect(j.at).toBeCloseTo(69.3, 10);
    // A cell inside one period is a plain interval.
    expect(f({ x: iv(1, 1.001), y: iv(0, 0.001) }).kind).toBe('interval');
  });

  test('floor(x) + 1 over [0.5, 1.5] is a jump with value [1, 2]', () => {
    expect(asJump(run('\\lfloor x\\rfloor + 1')({ x: iv(0.5, 1.5) }))).toEqual({
      at: 1,
      continuity: 'right',
      value: iv(1, 2),
    });
  });

  test('a jump inside a cases branch unions with the other branch', () => {
    const f = run(
      '\\begin{cases} \\lfloor x\\rfloor & x<0 \\\\ 7 & \\text{otherwise}\\end{cases}'
    );
    expect(asJump(f({ x: iv(-0.5, 0.5) })).value).toEqual(iv(-1, 7));
  });

  test('a pole is still a bare singular: 1/x across 0', () => {
    expectPole(run('\\frac{1}{x}')({ x: iv(-1, 1) }));
  });
});
