/**
 * CE-1372: zero to the power zero has no value in the engine. The
 * interpreter and the JavaScript targets answer `NaN`
 * (`docs/COMPILATION-MODEL.md`, forms with no value). The interval power
 * answers `empty` when the box is that one point: the point base `[0, 0]`
 * with the point exponent 0, as `1/[0, 0]` is `empty`. A box that holds the
 * point and others keeps its enclosure, which holds every value the
 * interpreter has at the other points. The power kernels answered the point
 * `[1, 1]` at `0^0`, so a comparison built on it was decided where the
 * interpreter decides the other way.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import {
  pow,
  powInterval,
  powReal,
  powRational,
} from '../../src/compute-engine/interval/elementary';
import type { IntervalResult } from '../../src/compute-engine/interval/types';

const I = (lo: number, hi: number) => ({ lo, hi });

/** The result as `[kind, lo, hi, mark]`, for compact pinning. */
function shape(r: unknown): unknown[] {
  const v = r as IntervalResult & { value?: { lo: number; hi: number } };
  const out: unknown[] = [v.kind];
  if (v.value !== undefined) out.push(v.value.lo, v.value.hi);
  if (v.kind === 'partial') out.push(v.domainClipped);
  return out;
}

describe('CE-1372, the kernels: x^0', () => {
  // Each base with the point exponent 0, through every entry point that
  // reaches the integer power.
  const table: Array<[string, { lo: number; hi: number }, unknown[]]> = [
    ['the point 0', I(0, 0), ['empty']],
    ['the point -0', I(-0, -0), ['empty']],
    ['the point [-0, 0]', I(-0, 0), ['empty']],
    ['0 at the lower end', I(0, 2), ['interval', 1, 1]],
    ['0 at the upper end', I(-2, 0), ['interval', 1, 1]],
    ['0 inside', I(-1, 2), ['interval', 1, 1]],
    ['no 0', I(0.5, 2), ['interval', 1, 1]],
  ];
  for (const [name, base, expected] of table)
    test(name, () => {
      expect(shape(pow(base, 0))).toEqual(expected);
      expect(shape(pow(base, -0))).toEqual(expected);
      expect(shape(powInterval(base, I(0, 0)))).toEqual(expected);
      expect(shape(powReal(base, I(0, 0), 17))).toEqual(expected);
      expect(shape(powRational(base, 0, 3))).toEqual(expected);
    });
});

describe('CE-1372, the kernels: an exponent interval that holds 0', () => {
  // Only the point box changes: every other box keeps its enclosure.
  const grid: Array<[[number, number], [number, number], unknown[]]> = [
    [[0, 0], [0, 1], ['interval', 0, 1]],
    [[0, 0], [-1, 1], ['partial', 0, 1, 'lo']],
    [[0, 0], [-1, 0], ['partial', 1, 1, 'lo']],
    [[0, 0], [0.5, 1], ['interval', 0, 0]],
    [[0, 0], [-1, -0.5], ['empty']],
    [[0, 2], [0, 1], ['interval', 0, 2.0000000000000004]],
    [[0, 2], [-1, 1], ['partial', 0, Infinity, 'lo']],
    [[-2, 0], [0, 1], ['interval', -2, 2]],
    [[-1, 2], [0, 1], ['interval', -1.0000000000000002, 2]],
  ];
  for (const [[a, b], [c, d], expected] of grid)
    test(`[${a}, ${b}]^[${c}, ${d}]`, () => {
      expect(shape(powInterval(I(a, b), I(c, d)))).toEqual(expected);
      expect(shape(powReal(I(a, b), I(c, d), 17))).toEqual(expected);
    });
});

describe('CE-1372, both interval targets against the interpreter', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  type Json = unknown;
  type Run = (v: Record<string, unknown>) => unknown;
  const targets = (json: Json): Run[] => {
    const e = ce.box(json as never);
    return [{}, { profile: 'ir' }].map((o) => {
      const r = compile(e, {
        to: 'interval-js',
        fallback: false,
        ...o,
      } as never) as unknown as { success: boolean; run: Run };
      expect(r.success).toBe(true);
      return r.run;
    });
  };
  const box = (b: Record<string, [number, number]>) =>
    Object.fromEntries(
      Object.entries(b).map(([k, [lo, hi]]) => [k, I(lo, hi)])
    );
  const interpret = (json: Json, p: Record<string, number>) =>
    ce.box(json as never).subs(p).N();

  test('the witnesses of the issue', () => {
    const power = ['Power', 'y', 'x'];
    expect(interpret(power, { x: 0, y: 0 }).isNaN).toBe(true);
    for (const run of targets(power))
      expect(shape(run(box({ x: [0, 0], y: [0, 0] })))).toEqual(['empty']);
    // A comparison with an `empty` operand is `'false'`, the interpreter's
    // verdict at the point (`comparison.ts`, `hasEmptyOperand`).
    const less = [
      'Less',
      0,
      ['Add', ['Multiply', 'y', ['Power', 'y', ['Floor', 'x']]], 1],
    ];
    expect(interpret(less, { x: 0.5, y: 0 }).symbol).toBe('False');
    for (const run of targets(less))
      expect(run(box({ x: [0.5, 0.5], y: [0, 0] }))).toBe('false');
  });

  // Each form at a box. An `empty` box: the interpreter has no value at its
  // points. Any other box keeps the result it had, which contains the
  // interpreter's values at the listed points.
  const sum = ['Sum', ['Power', 'x', 'k'], ['Limits', 'k', 0, 3]];
  const forms: Array<
    [
      string,
      Json,
      Record<string, [number, number]>,
      unknown[],
      Array<Record<string, number>>,
    ]
  > = [
    ['y^x at (0, 0)', ['Power', 'y', 'x'], { x: [0, 0], y: [0, 0] }, ['empty'], []],
    ['y^x, a base across 0', ['Power', 'y', 'x'], { x: [0, 0], y: [0, 1] }, ['interval', 1, 1], [{ x: 0, y: 0.5 }, { x: 0, y: 1 }]],
    ['y^x, an exponent across 0', ['Power', 'y', 'x'], { x: [0, 1], y: [0, 0] }, ['interval', 0, 1], [{ x: 0.5, y: 0 }, { x: 1, y: 0 }]],
    ['0^x at 0', ['Power', 0, 'x'], { x: [0, 0] }, ['empty'], []],
    ['0^x, x > 0', ['Power', 0, 'x'], { x: [0.5, 0.5] }, ['interval', 0, 0], [{ x: 0.5 }]],
    ['0^x, a box from 0', ['Power', 0, 'x'], { x: [0, 1] }, ['interval', 0, 1], [{ x: 0.5 }, { x: 1 }]],
    ['y^Floor(x), y = 0, x in [0, 1)', ['Power', 'y', ['Floor', 'x']], { x: [0, 0.9], y: [0, 0] }, ['empty'], []],
    ['|y|^x', ['Power', ['Abs', 'y'], 'x'], { x: [0, 0], y: [-1, 1] }, ['interval', 1, 1], [{ x: 0, y: -0.5 }]],
    ['Sqrt(y)^x', ['Power', ['Sqrt', 'y'], 'x'], { x: [0, 0], y: [0, 1] }, ['interval', 1, 1], [{ x: 0, y: 0.25 }]],
    ['Sum(x^k, k = 0..3) at 0', sum, { x: [0, 0] }, ['empty'], []],
    ['Sum(x^k, k = 0..3) across 0', sum, { x: [-1, 1] }, ['interval', -1, 4], [{ x: -1 }, { x: 0.5 }, { x: 1 }]],
    ['Sum(x^k, k = 0..3) at 2', sum, { x: [2, 2] }, ['interval', 15, 15], [{ x: 2 }]],
  ];
  for (const [name, json, b, expected, points] of forms)
    test(name, () => {
      for (const run of targets(json)) {
        const r = run(box(b)) as { value?: { lo: number; hi: number } };
        expect(shape(r)).toEqual(expected);
        for (const p of points) {
          const v = interpret(json, p).re;
          expect(r.value!.lo).toBeLessThanOrEqual(v);
          expect(r.value!.hi).toBeGreaterThanOrEqual(v);
        }
      }
      if (expected[0] === 'empty') {
        const corner = Object.fromEntries(
          Object.entries(b).map(([n, [lo]]) => [n, lo])
        );
        expect(interpret(json, corner).isNaN).toBe(true);
      }
    });

  test('a literal exponent 0 is 1 before any kernel', () => {
    // `Power(y, 0)` is 1 at canonicalization, so the interpreter gives 1 at
    // `y = 0`, and so do both interval targets.
    expect(ce.box(['Power', 'y', 0]).json).toBe(1);
    for (const run of targets(['Power', 'y', 0]))
      expect(shape(run(box({ y: [0, 0] })))).toEqual(['interval', 1, 1]);
  });

  test('an integral whose integrand has 0^0 at one end keeps its closed form', () => {
    const integral = [
      'Integrate',
      ['Function', ['Sum', ['Divide', ['Power', 't', 'k'], ['Factorial', 'k']], ['Limits', 'k', 0, 4]], 't'],
      ['Limits', 't', 0, 'x'],
    ];
    const v = interpret(integral, { x: 0.15 }).re;
    for (const run of targets(integral)) {
      const r = run(box({ x: [0.15, 0.15] })) as {
        kind: string;
        value: { lo: number; hi: number };
      };
      expect(r.kind).toBe('interval');
      expect(r.value.lo).toBeLessThanOrEqual(v);
      expect(r.value.hi).toBeGreaterThanOrEqual(v);
      expect(r.value.hi - r.value.lo).toBeLessThan(1e-15);
    }
  });
});
