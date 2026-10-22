/**
 * Tycho ledger row 420 (`~/dev/tycho/docs/COMPUTE_ENGINE.md`, filed
 * 2026-10-22 on CE 0.161.0): the derivative of a finite sum whose upper
 * bound is `⌊x⌋`.
 *
 * (a) `D(Sum(Cos(i x), Limits(i, 1, Floor(x))), x)` stayed unevaluated: a
 * bound that depends on the variable declined the rule for a sum. A bound
 * whose derivative is 0, a step of the variable, now keeps the rule:
 * between two jumps the set of terms is fixed, and the derivative is the sum
 * of the derivatives of the terms.
 *
 * (b) The numerical derivative of a function that stays symbolic (its
 * javascript compile, and `ND`) used a stencil whose window reaches 0.4 on
 * each side of the point, so a jump in it entered the value: −5.3 at
 * x = 1.9 where the derivative is −0.95. The step is now halved until the
 * stencils of two steps agree, and the value at a jump is `NaN`.
 *
 * The first cases follow Tycho's instrument
 * (`scripts/repros/2026-10-22-ce420-floor-bound-sum-derivative-repro.mts`),
 * through the box route it takes.
 */

import { ComputeEngine, compile } from '../../src/compute-engine';
import {
  centeredDiff8thOrder,
  centeredDiffHigherOrder,
  centeredDiffHigherOrderVector,
} from '../../src/compute-engine/numerics/numeric';

const ce = new ComputeEngine();

const FLOOR_SUM = [
  'Sum',
  ['Cos', ['Multiply', 'i', 'x']],
  ['Limits', 'i', 1, ['Floor', 'x']],
];

/** Σ_{i=1}^{⌊x⌋} −i·sin(i x), the derivative between two integers. */
const exact = (x: number): number => {
  let s = 0;
  for (let i = 1; i <= Math.floor(x); i++) s -= i * Math.sin(i * x);
  return s;
};

const POINTS = [1.2, 1.5, 1.7, 1.9, 2.5, 3.1];

describe('row 420 (a): a sum whose bound is a step of the variable', () => {
  test('the derivative closes, term by term (the instrument)', () => {
    const d = ce.box(['D', FLOOR_SUM, 'x'] as any).evaluate();
    expect(d.operator).toBe('Sum');
    expect(JSON.stringify(d.json)).not.toContain('"D"');
    expect(d.toString()).toContain('floor(x)');
  });

  test('its javascript compile is the derivative between integers (the instrument)', () => {
    const d = ce.box(['D', FLOOR_SUM, 'x'] as any).evaluate();
    const r = compile(d, { to: 'javascript' }) as any;
    expect(r.success).toBe(true);
    for (const x of POINTS) expect(r.run({ x })).toBeCloseTo(exact(x), 10);
  });

  test('its interval-js compile encloses the derivative between integers', () => {
    const d = ce.box(['D', FLOOR_SUM, 'x'] as any).evaluate();
    const r = compile(d, { to: 'interval-js' }) as any;
    expect(r.success).toBe(true);
    const v = r.run({ x: { lo: 1.2, hi: 1.3 } });
    expect(v.kind).toBe('interval');
    expect(v.value.lo).toBeLessThanOrEqual(exact(1.3));
    expect(v.value.hi).toBeGreaterThanOrEqual(exact(1.2));
  });

  test('the derivative of order 2 closes too', () => {
    const d = ce.box(['D', ['D', FLOOR_SUM, 'x'], 'x'] as any).evaluate();
    expect(d.operator).toBe('Sum');
    expect(d.toString()).toContain('cos');
  });

  test('other step bounds: ⌈x/2⌉ as the lower bound, round(2x) as the upper', () => {
    const lower = ce
      .box([
        'D',
        [
          'Sum',
          ['Cos', ['Multiply', 'i', 'x']],
          ['Limits', 'i', ['Ceil', ['Divide', 'x', 2]], 5],
        ],
        'x',
      ] as any)
      .evaluate();
    expect(lower.operator).toBe('Sum');
    const upper = ce
      .box([
        'D',
        [
          'Sum',
          ['Power', 'x', 'i'],
          ['Limits', 'i', 0, ['Round', ['Multiply', 2, 'x']]],
        ],
        'x',
      ] as any)
      .evaluate();
    expect(upper.operator).toBe('Sum');
  });

  test('a bound that is not a step keeps the derivative unevaluated', () => {
    const d = ce
      .box([
        'D',
        ['Sum', ['Cos', ['Multiply', 'i', 'x']], ['Limits', 'i', 1, 'x']],
        'x',
      ] as any)
      .evaluate();
    expect(d.operator).toBe('D');
  });
});

describe('row 420 (b): the numerical derivative does not read across a jump', () => {
  // A product with a bound that depends on the variable stays symbolic
  // (its factors are expanded only for literal bounds), so its compile is
  // the numerical derivative.
  const PRODUCT = [
    'D',
    ['Product', ['Add', 'x', 'i'], ['Limits', 'i', 1, ['Floor', 'x']]],
    'x',
  ];
  /** d/dx Π_{i=1}^{⌊x⌋} (x + i), between two integers. */
  const productDerivative = (x: number): number => {
    const n = Math.floor(x);
    let s = 0;
    for (let j = 1; j <= n; j++) {
      let p = 1;
      for (let i = 1; i <= n; i++) if (i !== j) p *= x + i;
      s += p;
    }
    return s;
  };

  test('between two integers, the value is the derivative there', () => {
    const r = compile(ce.box(PRODUCT as any), { to: 'javascript' }) as any;
    expect(r.success).toBe(true);
    // 1.9 and 3.999 are 0.1 and 0.001 from the next jump: the first window
    // reached 0.4 and gave 57.3 and 9914.3.
    for (const x of [1.2, 1.7, 1.9, 1.99, 2.5, 3.1, 3.999])
      expect(r.run({ x })).toBeCloseTo(productDerivative(x), 6);
  });

  test('at a jump, the value is NaN', () => {
    const r = compile(ce.box(PRODUCT as any), { to: 'javascript' }) as any;
    expect(r.run({ x: 2 })).toBeNaN();
    expect(r.run({ x: 3 })).toBeNaN();
  });

  test('ND of x·⌊x⌋: ⌊x⌋ between integers, no value at one', () => {
    const nd = (x: number) =>
      ce
        .box(['ND', ['Function', ['Multiply', 'x', ['Floor', 'x']], 'x'], x])
        .N();
    expect(nd(0.98).re).toBe(0);
    expect(nd(1.95).re).toBeCloseTo(1, 8);
    // At 2 the stencil gives no value, and `ND` stays unevaluated.
    expect(nd(2).operator).toBe('ND');
  });

  test('a function that varies faster than the first step is resolved', () => {
    // At a step of 0.1 the value for cos(20 x) was off by 14%; two steps
    // agree to 10⁻⁶ relative.
    const v = centeredDiffHigherOrder((t) => Math.cos(20 * t), 0.05, 1);
    expect(Math.abs(v / (-20 * Math.sin(1)) - 1)).toBeLessThan(1e-6);
  });

  test('a smooth function keeps the value of the first step, bit for bit', () => {
    for (const x of [0.7, 2.3, 10])
      expect(centeredDiffHigherOrder(Math.sin, x, 1)).toBe(
        centeredDiff8thOrder(Math.sin, x, 0.1)
      );
  });

  test('a derivative of higher order that is 0 is not NaN', () => {
    // The 4th derivative of 10⁶ x³: the two stencils agree within their
    // rounding.
    const v = centeredDiffHigherOrder((t) => 1e6 * t ** 3, 0.7, 4);
    expect(Number.isFinite(v)).toBe(true);
    expect(Math.abs(v)).toBeLessThan(1);
  });
});

describe('row 420 (b): the cases of the review', () => {
  test('a derivative that is 0 where f is 0 is 0, not NaN', () => {
    // t⁹ at 0: the values shrink 256 times at each halving.
    expect(Math.abs(centeredDiffHigherOrder((t) => t ** 9, 0, 1))).toBeLessThan(
      1e-9
    );
    // The 2nd derivative at a zero of the function: rounding only.
    for (const [f, x] of [
      [Math.sin, 0],
      [Math.sin, Math.PI],
      [Math.tanh, 0],
    ] as [(t: number) => number, number][])
      expect(Math.abs(centeredDiffHigherOrder(f, x, 2))).toBeLessThan(1e-12);
  });

  test('a point where f has no value, which the stencil of order 1 does not sample', () => {
    const v = centeredDiffHigherOrder((t) => Math.sin(t) / t, 0, 1);
    expect(Math.abs(v)).toBeLessThan(1e-12);
  });

  test('an overflow in the first window is not taken as the value', () => {
    // exp(1000 t) at 0.4: the first window reaches e^800, an overflow.
    const v = centeredDiffHigherOrder((t) => Math.exp(1000 * t), 0.4, 1);
    expect(Math.abs(v / (1000 * Math.exp(400)) - 1)).toBeLessThan(1e-4);
  });

  test('the vector form settles each component on its own', () => {
    const v = centeredDiffHigherOrderVector(
      (t) => [Math.sin(t) / t, t, Math.floor(t)],
      0,
      1
    )!;
    expect(Math.abs(v[0])).toBeLessThan(1e-12);
    expect(v[1]).toBeCloseTo(1, 12);
    // ⌊t⌋ jumps at 0.
    expect(v[2]).toBeNaN();
  });

  test('D of a sum bounded by Truncate(x) closes too', () => {
    const d = ce
      .box([
        'D',
        [
          'Sum',
          ['Cos', ['Multiply', 'i', 'x']],
          ['Limits', 'i', 1, ['Truncate', 'x']],
        ],
        'x',
      ] as any)
      .evaluate();
    expect(d.operator).toBe('Sum');
    expect(
      ce
        .box(['D', ['Truncate', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('0');
  });
});
