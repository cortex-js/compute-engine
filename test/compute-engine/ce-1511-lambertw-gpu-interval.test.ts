/**
 * CE-1511: `LambertW(x)` of a real `x` compiles on the interval target
 * (`_IA.lambertw`, the principal branch W₀) and on GLSL
 * (`_gpu_ir_lambertw`; its values are in `ir-glsl-special.test.ts`). Both
 * declined.
 *
 * The interval of W₀ over a box holds W₀ at each point of the box (its
 * 40-digit value, `bigLambertW`): `empty` below -1/e, `partial` with the
 * lower bound -1 where the box starts below -1/e.
 *
 * The double kernel gives W₀ for x above 1e154 too: Halley's step
 * overflowed there and the first estimate was the value
 * (`LambertW(1e300)` was 684.24717..., not 684.24720...), and next to the
 * largest double w·e^w overflowed.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { bigLambertW, lambertW } from '../../src/numerics';
import { BigDecimal } from '../../src/big-decimal/index';

const ce = new ComputeEngine();

type Result =
  | { kind: 'interval'; value: { lo: number; hi: number } }
  | {
      kind: 'partial';
      value: { lo: number; hi: number };
      domainClipped: string;
    }
  | { kind: 'empty' };

const compiled = (to: string) =>
  compile(ce.box(['LambertW', 'x'] as never), {
    to,
    fallback: false,
    inputs: { x: 'real' },
  } as never) as unknown as {
    success: boolean;
    code: string;
    run: (v: object) => unknown;
  };

/** W₀(x) to 40 digits, from the exact binary value of the double x. */
const reference = (x: number): number =>
  bigLambertW(ce as never, new BigDecimal(x.toPrecision(80)), 0, 40).toNumber();

describe('LambertW compiles on the interval target', () => {
  const f = compiled('interval-js');
  const run = (lo: number, hi: number) => f.run({ x: { lo, hi } }) as Result;

  test('it compiles to the interval kernel', () => {
    expect(f.success).toBe(true);
    expect(f.code).toMatch(/_IA\.lambertw\(/);
  });

  test('the interval of a box holds W₀ at its endpoints', () => {
    // The double of -1/e, -0.36787944117144233, is below -1/e; the next
    // double above it is not.
    expect(run(-0.36787944117144233, -0.36787944117144233)).toEqual({
      kind: 'empty',
    });
    const points = [
      -0.3678794411714423,
      -0.3678794411,
      -0.3678,
      -0.35,
      -0.3,
      -0.1,
      -1e-12,
      1e-300,
      1e-8,
      0.25,
      1,
      Math.E,
      10,
      1e5,
      1e100,
      1e200,
      1e300,
    ];
    for (const x of points) {
      const r = run(x, x);
      expect(r.kind).toBe('interval');
      if (r.kind !== 'interval') continue;
      const w = reference(x);
      expect(r.value.lo).toBeLessThanOrEqual(w);
      expect(r.value.hi).toBeGreaterThanOrEqual(w);
      // About 8 ulps on each side.
      expect(r.value.hi - r.value.lo).toBeLessThan(4e-15 * Math.abs(w));
    }
    for (const [lo, hi] of [
      [-0.3, 0.5],
      [0.5, 3],
      [1e10, 1e20],
    ]) {
      const r = run(lo, hi);
      expect(r.kind).toBe('interval');
      if (r.kind !== 'interval') continue;
      expect(r.value.lo).toBeLessThanOrEqual(reference(lo));
      expect(r.value.hi).toBeGreaterThanOrEqual(reference(hi));
    }
  });

  test('W₀(0) is exactly 0', () => {
    expect(run(0, 0)).toEqual({ kind: 'interval', value: { lo: 0, hi: 0 } });
  });

  test('below -1/e there is no real value', () => {
    expect(run(-1, -0.5)).toEqual({ kind: 'empty' });
    expect(run(-Infinity, -0.37)).toEqual({ kind: 'empty' });
  });

  test('a box that starts below -1/e has the lower bound -1', () => {
    for (const lo of [-0.5, -Infinity]) {
      const r = run(lo, 1);
      expect(r.kind).toBe('partial');
      if (r.kind !== 'partial') continue;
      expect(r.domainClipped).toBe('lo');
      expect(r.value.lo).toBeLessThanOrEqual(-1);
      expect(r.value.lo).toBeGreaterThan(-1 - 1e-14);
      expect(r.value.hi).toBeGreaterThanOrEqual(reference(1));
    }
  });

  test('at +∞ the upper bound is +∞', () => {
    const r = run(1e300, Infinity);
    expect(r.kind).toBe('interval');
    if (r.kind === 'interval') expect(r.value.hi).toBe(Infinity);
  });
});

describe('LambertW compiles on GLSL', () => {
  test('it compiles to the helper', () => {
    const f = compiled('glsl');
    expect(f.success).toBe(true);
    expect(f.code).toBe('_gpu_ir_lambertw(x)');
  });
});

describe('the double kernel of W₀ for a large argument', () => {
  test.each([1e100, 1e154, 1e155, 1e200, 1e300, 1.7976931348623157e308])(
    'W₀(%p) is within 2 ulps of its 40-digit value',
    (x) => {
      const w = reference(x);
      expect(Math.abs(lambertW(x) - w)).toBeLessThanOrEqual(
        2 * Number.EPSILON * w
      );
    }
  );

  test('the interpreter and the compiled JavaScript give it', () => {
    const want = reference(1e300);
    const f = compiled('javascript');
    expect(
      Math.abs((f.run({ x: 1e300 }) as number) - want)
    ).toBeLessThanOrEqual(2 * Number.EPSILON * want);
    expect(
      Math.abs(ce.box(['LambertW', 1e300] as never).N().re - want)
    ).toBeLessThanOrEqual(2 * Number.EPSILON * want);
  });
});
