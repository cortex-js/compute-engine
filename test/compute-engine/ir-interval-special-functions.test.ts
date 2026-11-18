/**
 * `Sinc`, `Chop`, `Gamma` and `Erf` on `interval-js`, of a declared and of
 * an undeclared input: an undeclared input whose inferred type is a number
 * type (`complex | infinity` from the signature of `Gamma`) is read as a
 * real (README of `ir/`, "The interval mode"), a declared `complex` input
 * still declines.
 *
 * Containment: at points of each box (its ends, its middle, evenly spaced
 * points, and the points of `special` inside it), the interpreter's real
 * value (`expr.subs({ x }).N()`) is inside the result, within 2 ulps. A box
 * that holds a pole of `Gamma` has no finite enclosure.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { nextDown, nextUp } from '../../src/compute-engine/numerics/numeric';
import { IntervalArithmetic as IA } from '../../src/compute-engine/interval/index';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  fresnelC as scalarFresnelC,
  fresnelS as scalarFresnelS,
} from '../../src/compute-engine/numerics/special-functions';

type Box = [number, number];
type Result = {
  kind: string;
  value?: { lo: number; hi: number };
};

const engine = (declared: boolean): ComputeEngine => {
  const ce = new ComputeEngine();
  if (declared) ce.declare('x', 'real');
  return ce;
};

const run = (ce: ComputeEngine, json: unknown) => {
  const expr = ce.box(json as never);
  const r = compile(expr as never, { to: 'interval-js' } as never) as {
    success: boolean;
    run: (x: { x: { lo: number; hi: number } }) => Result;
    freeSymbolTypes?: Record<string, unknown>;
  };
  return { expr, r };
};

const widen = (k: { lo: number; hi: number }) => ({
  lo: nextDown(nextDown(k.lo)),
  hi: nextUp(nextUp(k.hi)),
});

/** The interpreter's real value of `expr` at `x = p`, or `undefined` when
 *  it is not a finite real. */
const reference = (
  ce: ComputeEngine,
  expr: Expression,
  p: number
): number | undefined => {
  const v = expr.subs({ x: ce.number(p) }).N();
  if (!v.isNumberLiteral || v.im !== 0) return undefined;
  return Number.isFinite(v.re) ? v.re : undefined;
};

const points = ([lo, hi]: Box, special: number[]): number[] => {
  const n = 8;
  const even = Array.from(
    { length: n + 1 },
    (_, k) => lo + ((hi - lo) * k) / n
  );
  return [
    ...new Set([lo, hi, ...even, ...special.filter((s) => s >= lo && s <= hi)]),
  ];
};

/** The points of `box` whose value the result misses. */
const misses = (
  ce: ComputeEngine,
  json: unknown,
  box: Box,
  special: number[] = []
): string[] => {
  const { expr, r } = run(ce, json);
  expect(r.success).toBe(true);
  const result = r.run({ x: { lo: box[0], hi: box[1] } });
  const out: string[] = [];
  for (const p of points(box, special)) {
    const v = reference(ce, expr, p);
    if (v === undefined) continue;
    const k = result.value;
    if (
      (result.kind !== 'interval' && result.kind !== 'singular') ||
      k === undefined
    ) {
      // `entire` holds every value.
      if (result.kind === 'entire') continue;
      out.push(`${p}: ${v} not in ${JSON.stringify(result)}`);
      continue;
    }
    const w = widen(k);
    if (!(w.lo <= v && v <= w.hi))
      out.push(`${p}: ${v} not in ${JSON.stringify(result)}`);
  }
  return out;
};

const TOL = new ComputeEngine().tolerance;

// prettier-ignore
const CASES: [label: string, json: unknown, boxes: Box[], special?: number[]][] = [
  ['Sinc', ['Sinc', 'x'], [[-1, 1], [0, 0], [2, 5], [-10, -3], [1e-8, 2e-8], [-40, 40]], [0]],
  ['Erf', ['Erf', 'x'], [[-3, 3], [0.1, 0.2], [-10, -5], [0, 0], [4, 30]]],
  ['Gamma', ['Gamma', 'x'], [[0.5, 3], [-0.5, -0.2], [-2.7, -2.2], [3, 6], [1e-3, 0.1], [-3.9, -3.1]]],
  ['Chop', ['Chop', 'x'], [[-1e-9, 1e-9], [-TOL, TOL], [0.5, 1], [-2e-10, 5e-11], [TOL, TOL], [-TOL, -TOL], [-1, 1]], [TOL, -TOL, 0]],
  ['Chop(x, 0.01)', ['Chop', 'x', 0.01], [[-0.02, 0.02], [0.01, 0.01], [-0.01, -0.01], [0.005, 0.5], [-3, -0.001]], [0.01, -0.01, 0]],
];

describe('Sinc, Chop, Gamma and Erf on interval-js', () => {
  for (const declared of [true, false]) {
    const ce = engine(declared);
    const label = declared ? 'declared real' : 'undeclared';
    for (const [name, json, boxes, special] of CASES)
      test(`${name}, ${label}: containment`, () => {
        for (const box of boxes)
          expect([box, misses(ce, json, box, special)]).toEqual([box, []]);
      });
  }

  test('Gamma over a box that holds a pole has no finite enclosure', () => {
    for (const declared of [true, false]) {
      const { r } = run(engine(declared), ['Gamma', 'x']);
      for (const box of [
        [-1.5, -0.5],
        [-0.1, 0.1],
        [0, 0],
        [-2, -2],
        [-5, 2],
      ] as Box[]) {
        const result = r.run({ x: { lo: box[0], hi: box[1] } });
        const k = result.value;
        const finite =
          result.kind === 'interval' &&
          k !== undefined &&
          Number.isFinite(k.lo) &&
          Number.isFinite(k.hi);
        expect([box, finite]).toEqual([box, false]);
      }
    }
  });

  test('the report of an undeclared input keeps its inferred type', () => {
    const { r } = run(engine(false), ['Gamma', 'x']);
    expect(r.freeSymbolTypes).toEqual({
      x: {
        type: 'complex | infinity',
        lowered: 'interval',
        provenance: 'inferred',
      },
    });
    const declared = run(engine(true), ['Gamma', 'x']).r;
    expect(declared.freeSymbolTypes).toEqual({
      x: { type: 'real', lowered: 'interval', provenance: 'declared' },
    });
  });

  test('an undeclared input that a function reads is a real', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    ce.assign(
      'g',
      ce.box(['Function', ['Add', ['Gamma', 'x'], 't'], 't'] as never)
    );
    const expr = ce.box(['Add', ['g', 'y'], ['g', 2]] as never);
    const r = compile(expr as never, { to: 'interval-js' } as never) as {
      success: boolean;
      run: (x: Record<string, { lo: number; hi: number }>) => Result;
      freeSymbolTypes?: Record<string, { provenance: string; lowered: string }>;
    };
    expect(r.success).toBe(true);
    expect(r.freeSymbolTypes?.x).toMatchObject({
      lowered: 'interval',
      provenance: 'inferred',
    });
    const k = r.run({ x: { lo: 3, hi: 3 }, y: { lo: 1, hi: 1 } }).value!;
    // Γ(3) + 1 + Γ(3) + 2 = 7
    expect(k.lo <= 7 && 7 <= k.hi).toBe(true);
  });

  test('a declared complex or imaginary input still declines', () => {
    for (const t of ['complex', 'imaginary'])
      for (const f of ['Sinc', 'Gamma', 'Erf', 'Chop']) {
        const ce = new ComputeEngine();
        ce.declare('x', t as never);
        const r = compile(
          ce.box([f, 'x'] as never) as never,
          {
            to: 'interval-js',
          } as never
        ) as { success: boolean };
        expect([t, f, r.success]).toEqual([t, f, false]);
      }
  });

  test('Chop with a tolerance that is not a constant declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    const r = compile(
      ce.box(['Chop', 'x', 'y'] as never) as never,
      {
        to: 'interval-js',
      } as never
    ) as { success: boolean };
    expect(r.success).toBe(false);
  });
});

describe('Chop on JavaScript', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('y', 'real');
  const values = (
    json: unknown,
    xs: number[],
    extra: Record<string, number> = {}
  ) => {
    const expr = ce.box(json as never);
    const r = compile(expr as never, { to: 'javascript' } as never) as {
      success: boolean;
      run: (x: Record<string, number>) => number;
    };
    expect(r.success).toBe(true);
    return xs.map((x) => {
      const subs = Object.fromEntries(
        Object.entries({ x, ...extra }).map(([k, v]) => [k, ce.number(v)])
      );
      return [r.run({ x, ...extra }), expr.subs(subs).N().re];
    });
  };

  test('Chop(x) at the engine tolerance', () => {
    for (const [got, want] of values(
      ['Chop', 'x'],
      [1e-11, -1e-11, TOL, -TOL, 1e-9, 0.5, -3]
    ))
      expect(got).toBe(want);
  });

  test('Chop(x, 0.01)', () => {
    for (const [got, want] of values(
      ['Chop', 'x', 0.01],
      [0.01, -0.01, 0.005, 0.02, -0.5]
    ))
      expect(got).toBe(want);
  });

  test('Chop(x, y), a run-time tolerance', () => {
    for (const [got, want] of values(['Chop', 'x', 'y'], [0.01, 0.2, -0.05], {
      y: 0.1,
    }))
      expect(got).toBe(want);
  });

  test('Chop of a list', () => {
    const r = compile(
      ce.box(['Chop', ['List', 'x', 1e-20, 2]] as never) as never,
      {
        to: 'javascript',
      } as never
    ) as { success: boolean; run: (x: Record<string, number>) => number[] };
    expect(r.success).toBe(true);
    expect(r.run({ x: 1e-12 })).toEqual([0, 0, 2]);
  });

  test('Chop of a complex input declines', () => {
    const c = new ComputeEngine();
    c.declare('z', 'complex');
    const r = compile(
      c.box(['Chop', 'z'] as never) as never,
      {
        to: 'javascript',
      } as never
    ) as { success: boolean };
    expect(r.success).toBe(false);
  });
});

describe('the jumps of the interval Chop', () => {
  const box = (lo: number, hi: number) => ({ lo, hi });
  test('a box across the edge t of the band: continuous from the left', () => {
    expect(IA.chop(box(0, 1), 0.1)).toEqual({
      kind: 'singular',
      at: 0.1,
      continuity: 'left',
      value: { lo: 0, hi: 1 },
    });
    // The edge and a point outside the band.
    expect(IA.chop(box(0.1, 1), 0.1)).toMatchObject({
      kind: 'singular',
      at: 0.1,
    });
  });
  test('a box across the edge -t: continuous from the right', () => {
    expect(IA.chop(box(-1, -0.05), 0.1)).toEqual({
      kind: 'singular',
      at: -0.1,
      continuity: 'right',
      value: { lo: -1, hi: 0 },
    });
  });
  test('a box across both edges reports the first', () => {
    expect(IA.chop(box(-1, 1), 0.1)).toEqual({
      kind: 'singular',
      at: -0.1,
      continuity: 'right',
      value: { lo: -1, hi: 1 },
    });
  });
  test('a box inside the band, or on one side of an edge, is an interval', () => {
    expect(IA.chop(box(0, 0.05), 0.1)).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
    expect(IA.chop(box(-0.1, 0.1), 0.1)).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
    expect(IA.chop(box(0.2, 1), 0.1)).toEqual({
      kind: 'interval',
      value: { lo: 0.2, hi: 1 },
    });
    expect(IA.chop(box(-1, -0.2), 0.1)).toEqual({
      kind: 'interval',
      value: { lo: -1, hi: -0.2 },
    });
  });
  test('a tolerance of 0 has no jump', () => {
    expect(IA.chop(box(-1, 1), 0)).toEqual({
      kind: 'interval',
      value: { lo: -1, hi: 1 },
    });
  });
  test('the compiled Chop reports the jump', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const r = compile(
      ce.box(['Chop', 'x', 0.1] as never) as never,
      {
        to: 'interval-js',
      } as never
    ) as { run: (x: unknown) => Result };
    expect(r.run({ x: box(0, 1) })).toMatchObject({
      kind: 'singular',
      at: 0.1,
    });
  });
});

describe('Sinc over a box with an infinite end', () => {
  const ce = engine(true);
  const sinc = ce.box(['Sinc', 'x'] as never);
  const compiled = run(ce, ['Sinc', 'x']).r;
  const I = Infinity;
  // A box, and finite points of it.
  const CASES: [Box, number[]][] = [
    [
      [-I, -1],
      [-1, -2, -4.4934, -10, -1e3, -1e8],
    ],
    [
      [-I, 2],
      [2, 1, 0, -1, -4.4934, -7.7253, -1e6],
    ],
    [
      [-I, I],
      [0, 1e-9, -4.4934, 4.4934, 7.7253, 1e10, -1e10],
    ],
    [
      [5, I],
      [5, 7.7253, 14.0662, 1e3, 1e12],
    ],
  ];
  const contains = (r: Result, v: number) => {
    expect(r.value).toBeDefined();
    const w = widen(r.value!);
    return w.lo <= v && v <= w.hi;
  };
  test.each(CASES)('%j: the kernel and the compiled code', (box, xs) => {
    const k = IA.sinc({ lo: box[0], hi: box[1] }) as Result;
    const c = compiled.run({ x: { lo: box[0], hi: box[1] } });
    for (const p of xs) {
      const v = sinc.subs({ x: ce.number(p) }).N().re;
      expect([p, contains(k, v), contains(c, v)]).toEqual([p, true, true]);
    }
  });
  test('Sinc(Ln(x)) over [0, 1], where Ln has the lower end -∞', () => {
    const json = ['Sinc', ['Ln', 'x']];
    const expr = ce.box(json as never);
    const r = run(ce, json).r.run({ x: { lo: 0, hi: 1 } });
    for (const p of [1e-300, 1e-10, 0.01, 0.2, 0.5, 1]) {
      const v = expr.subs({ x: ce.number(p) }).N().re;
      expect([p, contains(r, v)]).toEqual([p, true]);
    }
  });
});

describe('FresnelS and FresnelC on interval-js', () => {
  // Containment with no tolerance: at dense points of each box (its ends,
  // 400 evenly spaced points, the extrema inside it and the neighbors of
  // each), the interpreter's value is inside the result. The kernels widen
  // by the measured error of the scalar approximation (1.2e-15 relative);
  // one outward ulp was not enough on [1.5, 1.7].
  const I = Infinity;
  const BOXES: Box[] = [
    [1.5, 1.7],
    [0, 3],
    [-3, 3],
    [-1, 0],
    [4, 5],
    [10, 11],
    [100, 101],
    [-I, 2],
    [5, I],
    [1.5, 1.5],
    [17.577, 17.577],
    [1e-5, 2e-5],
  ];
  const EXTREMA = Array.from({ length: 30 }, (_, n) => Math.sqrt(n + 1));
  const densePoints = ([lo, hi]: Box): number[] => {
    const a = Number.isFinite(lo) ? lo : Math.min(hi - 50, -50);
    const b = Number.isFinite(hi) ? hi : Math.max(lo + 50, 50);
    const n = 400;
    const pts = Array.from({ length: n + 1 }, (_, k) => a + ((b - a) * k) / n);
    for (const e of EXTREMA) pts.push(e, -e);
    if (!Number.isFinite(lo)) pts.push(-1e3, -1e6, -1e9);
    if (!Number.isFinite(hi)) pts.push(1e3, 1e6, 1e9);
    const out = pts.flatMap((p) => [nextDown(p), p, nextUp(p)]);
    return [...new Set([lo, hi, ...out])].filter(
      (p) => Number.isFinite(p) && p >= lo && p <= hi
    );
  };
  const strictMisses = (
    ce: ComputeEngine,
    json: unknown,
    box: Box,
    pts: number[]
  ): string[] => {
    const { expr, r } = run(ce, json);
    expect(r.success).toBe(true);
    const result = r.run({ x: { lo: box[0], hi: box[1] } });
    const k = result.value;
    // `partial`: Ln clips its domain at 0.
    if ((result.kind !== 'interval' && result.kind !== 'partial') || !k)
      return [`${JSON.stringify(result)}`];
    const out: string[] = [];
    for (const p of pts) {
      const v = reference(ce, expr, p);
      if (v === undefined) continue;
      if (!(k.lo <= v && v <= k.hi))
        out.push(`${p}: ${v} not in [${k.lo}, ${k.hi}]`);
    }
    return out;
  };

  for (const declared of [true, false]) {
    const ce = engine(declared);
    const label = declared ? 'declared real' : 'undeclared';
    for (const f of ['FresnelS', 'FresnelC'])
      test(`${f}, ${label}: containment`, () => {
        for (const box of BOXES)
          expect([
            box,
            strictMisses(ce, [f, 'x'], box, densePoints(box)),
          ]).toEqual([box, []]);
      });
    test(`FresnelS(x^2) and FresnelC(Ln(x)) over [0, 1], ${label}`, () => {
      const pts = [1e-300, 1e-10, ...densePoints([0, 1])];
      for (const json of [
        ['FresnelS', ['Power', 'x', 2]],
        ['FresnelC', ['Ln', 'x']],
      ])
        expect([json, strictMisses(ce, json, [0, 1], pts)]).toEqual([json, []]);
    });
  }

  test('the exact values: 0 at 0, ±1/2 at ±∞', () => {
    for (const k of [IA.fresnelS, IA.fresnelC]) {
      expect(k({ lo: 0, hi: 0 })).toEqual({
        kind: 'interval',
        value: { lo: 0, hi: 0 },
      });
      expect(k({ lo: I, hi: I })).toEqual({
        kind: 'interval',
        value: { lo: 0.5, hi: 0.5 },
      });
      expect(k({ lo: -I, hi: -I })).toEqual({
        kind: 'interval',
        value: { lo: -0.5, hi: -0.5 },
      });
      // A box with an end at 0 keeps that end: both are odd, and >= 0 for
      // x >= 0.
      expect((k({ lo: 0, hi: 2 }) as Result).value!.lo).toBe(0);
      expect((k({ lo: -2, hi: 0 }) as Result).value!.hi).toBe(0);
    }
  });

  // The operand is widened one ulp outward on each side of a point box (the
  // interpreter reads the decimal of the double, within half an ulp of it).
  const KERNELS = [
    ['FresnelS', IA.fresnelS, scalarFresnelS],
    ['FresnelC', IA.fresnelC, scalarFresnelC],
  ] as const;
  const POINTS = [1.5, 4.3, 6.2048, 17.577];
  test('a point box holds the value at the double, its neighbors and the interpreter', () => {
    const ce = engine(true);
    for (const [name, k, scalar] of KERNELS)
      for (const x of [...POINTS, ...POINTS.map((p) => -p)]) {
        const r = (k({ lo: x, hi: x }) as Result).value!;
        const v = ce.box([name, x] as never).N().re;
        const values = [scalar(x), scalar(nextDown(x)), scalar(nextUp(x)), v];
        expect([name, x, values.every((y) => r.lo <= y && y <= r.hi)]).toEqual([
          name,
          x,
          true,
        ]);
      }
  });
  test('a point box is widened on both sides', () => {
    // At 6.2048 the slope sin(πx²/2) is about 1: the point box [x, x] and
    // [x, nextUp(x)] read different neighbors.
    for (const [, k] of KERNELS)
      for (const x of [6.2048, -6.2048]) {
        const point = k({ lo: x, hi: x });
        const right = k({ lo: x, hi: nextUp(x) });
        const left = k({ lo: nextDown(x), hi: x });
        expect(point).not.toEqual(right);
        expect(point).not.toEqual(left);
      }
  });

  test('a NaN end gives a NaN enclosure', () => {
    for (const k of [IA.fresnelS, IA.fresnelC])
      for (const box of [
        { lo: NaN, hi: NaN },
        { lo: NaN, hi: 2 },
      ]) {
        const v = (k(box) as Result).value!;
        expect([Number.isNaN(v.lo), Number.isNaN(v.hi)]).toEqual([true, true]);
      }
  });

  test('a declared complex input declines', () => {
    for (const f of ['FresnelS', 'FresnelC']) {
      const ce = new ComputeEngine();
      ce.declare('x', 'complex');
      const r = compile(
        ce.box([f, 'x'] as never) as never,
        {
          to: 'interval-js',
        } as never
      ) as { success: boolean };
      expect([f, r.success]).toEqual([f, false]);
    }
  });
});

describe('Heaviside and Remainder on interval-js', () => {
  const ce = engine(true);
  ce.declare('n', 'integer');
  ce.declare('m', 'integer');
  const compiled = (json: unknown) =>
    compile(
      ce.box(json as never) as never,
      {
        to: 'interval-js',
        fallback: false,
      } as never
    ) as {
      code: string;
      run: (x: Record<string, { lo: number; hi: number }>) => Result;
    };
  const box = (lo: number, hi = lo) => ({ lo, hi });

  test('the kernels', () => {
    expect(compiled(['Heaviside', 'x']).code).toBe('_IA.heaviside(_.x)');
    expect(compiled(['Remainder', 'n', 'm']).code).toBe(
      '_IA.remainder(_.n, _.m)'
    );
    expect(compiled(['Remainder', 'x', 'n']).code).toBe(
      '_IA.remainder(_.x, _.n)'
    );
  });

  test('Heaviside is 1/2 at 0, and a jump at 0 over a box that holds 0', () => {
    const h = compiled(['Heaviside', 'x']);
    expect(h.run({ x: box(0) })).toEqual({
      kind: 'interval',
      value: { lo: 0.5, hi: 0.5 },
    });
    expect(h.run({ x: box(-1, 1) })).toEqual({
      kind: 'singular',
      at: 0,
      value: { lo: 0, hi: 1 },
    });
    expect(h.run({ x: box(0, 2) })).toMatchObject({
      kind: 'singular',
      value: { lo: 0.5, hi: 1 },
    });
    expect(h.run({ x: box(-2, -1) })).toEqual({
      kind: 'interval',
      value: { lo: 0, hi: 0 },
    });
  });

  test('Remainder of integers: a tie of the quotient rounds toward +∞, a jump where the quotient crosses a half-integer', () => {
    const r = compiled(['Remainder', 'n', 'm']);
    // Remainder(5, 2) and Remainder(-5, 2) are -1, Remainder(5, -2) is 1.
    for (const [n, m, v] of [
      [5, 2, -1],
      [-5, 2, -1],
      [5, -2, 1],
      [7, 3, 1],
      [-7, 3, -1],
    ]) {
      expect(ce.box(['Remainder', n, m] as never).evaluate().re).toBe(v);
      expect([n, m, r.run({ n: box(n), m: box(m) })]).toEqual([
        n,
        m,
        { kind: 'interval', value: { lo: v, hi: v } },
      ]);
    }
    // The location of the jump is the quotient's, as for `Floor(2x)`.
    expect(r.run({ n: box(0, 3), m: box(2) })).toMatchObject({
      kind: 'singular',
      at: 0.5,
      continuity: 'right',
    });
    // A divisor 0 has no remainder (NaN): `empty`.
    expect(r.run({ n: box(1, 3), m: box(0) })).toEqual({ kind: 'empty' });
  });

  /** The remainder of `a` by `b` in BigInt, the quotient rounded to the
   *  nearest integer with a tie toward +∞. */
  const exactRemainder = (a: number, b: number): number => {
    const [x, y] = [BigInt(a), BigInt(b)];
    const m = y < 0n ? -y : y;
    let r = x % y;
    const h = 2n * (r < 0n ? -r : r);
    if (h > m || (h === m && r > 0n === y > 0n)) r -= r > 0n ? m : -m;
    return Number(r);
  };

  test('Remainder of a dividend between 2^52 and 2^53 is exact', () => {
    const r = compiled(['Remainder', 'n', 'm']);
    // `a / 3` rounds to a half-integer in doubles.
    for (const n of [7316119179121483, 7316119179121486, 7316119179121489]) {
      expect(ce.box(['Remainder', n, 3] as never).evaluate().re).toBe(1);
      expect([n, r.run({ n: box(n), m: box(3) })]).toEqual([
        n,
        { kind: 'interval', value: { lo: 1, hi: 1 } },
      ]);
    }
  });

  test('Remainder of random integers with |a| in [2^52, 2^53]: the point, and a box of a few integers', () => {
    // A seeded generator (an LCG): `a` takes every bit.
    let s = 98765;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const misses: string[] = [];
    for (let i = 0; i < 20000; i++) {
      const a =
        (2 ** 52 +
          Math.floor(rnd() * 2 ** 26) * 2 ** 26 +
          Math.floor(rnd() * 2 ** 26)) *
        (rnd() < 0.5 ? -1 : 1);
      const b = (Math.floor(rnd() * 1000) + 2) * (rnd() < 0.3 ? -1 : 1);
      const v = exactRemainder(a, b);
      const k = IA.remainder(box(a), box(b)) as Result;
      if (k.kind !== 'interval' || k.value?.lo !== v || k.value?.hi !== v)
        misses.push(`${a} ${b}: ${JSON.stringify(k)}, exact ${v}`);
      const w = 1 + (i % 5);
      const kb = IA.remainder(box(a, a + w), box(b)) as Result;
      for (let t = 0; t <= w; t++) {
        const u = exactRemainder(a + t, b);
        if (kb.value === undefined || u < kb.value.lo || u > kb.value.hi)
          misses.push(
            `[${a}, ${a + w}] ${b} at ${a + t}: ${JSON.stringify(kb)}, exact ${u}`
          );
      }
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });

  /** The exact value of a double, as a multiple of 2^-1074. */
  const exact = (x: number): bigint => {
    const v = new DataView(new ArrayBuffer(8));
    v.setFloat64(0, x);
    const bits = v.getBigUint64(0);
    const e = Number((bits >> 52n) & 0x7ffn);
    const f = bits & ((1n << 52n) - 1n);
    const m = e === 0 ? f << 1n : (f | (1n << 52n)) << BigInt(e);
    return bits >> 63n ? -m : m;
  };

  /** `a − b·round(a/b)` of two doubles in exact arithmetic (a multiple of
   *  2^-1074), the quotient rounded to the nearest integer with a tie
   *  toward +∞. */
  const exactRealRemainder = (a: number, b: number): bigint => {
    const [x, y] = [exact(a), exact(b)];
    let [num, den] = [2n * x + y, 2n * y];
    if (den < 0n) [num, den] = [-num, -den];
    let q = num / den;
    if (num % den !== 0n && num < 0n) q -= 1n;
    return x - y * q;
  };

  test('Remainder of reals encloses the exact remainder (CE-1448)', () => {
    const r = compiled(['Remainder', 'x', 0.7]);
    const a = -19.599995613098145;
    const v = r.run({ x: box(a) });
    expect(v.kind).toBe('interval');
    const want = exactRealRemainder(a, 0.7);
    expect(exact(v.value!.lo) <= want && want <= exact(v.value!.hi)).toBe(true);
    // A tie of the quotient rounds toward +∞: `Remainder(-0.35, 0.7)` is
    // `-0.35`.
    expect(r.run({ x: box(-0.35) })).toEqual({
      kind: 'interval',
      value: { lo: -0.35, hi: -0.35 },
    });

    let s = 4242;
    const rnd = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    const misses: string[] = [];
    for (let i = 0; i < 20000; i++) {
      const scale = [30, 1e6, 1e-3][i % 3];
      const p = (rnd() - 0.5) * 2 * scale;
      const q = (rnd() - 0.5) * 2 * [30, 1e6, 1e-3][(i >> 2) % 3] || 1;
      const w = Math.abs(p) * [0, 1e-12, 1e-4][(i >> 4) % 3];
      const k = IA.remainder(box(p, p + w), box(q)) as Result;
      if (k.value === undefined) continue;
      for (const t of [0, 0.5, 1]) {
        const u = exactRealRemainder(p + t * w, q);
        if (exact(k.value.lo) > u || u > exact(k.value.hi))
          misses.push(`[${p}, ${p + w}] ${q} at ${p + t * w}`);
      }
    }
    expect(misses.slice(0, 5)).toEqual([]);
  });
});

describe('GammaLn on interval-js at +∞ (CE-1450)', () => {
  const box = (lo: number, hi = lo) => ({ lo, hi });
  test('the upper end is +∞, not NaN', () => {
    expect(IA.gammaln(box(1, Infinity))).toMatchObject({
      kind: 'interval',
      value: { hi: Infinity },
    });
    expect(IA.gammaln(box(Infinity))).toEqual({
      kind: 'interval',
      value: { lo: Infinity, hi: Infinity },
    });
    const ce = engine(true);
    const r = compile(
      ce.parse('\\ln\\Gamma(1/x)') as never,
      {
        to: 'interval-js',
        fallback: false,
      } as never
    ) as { run: (x: Record<string, unknown>) => Result };
    expect(r.run({ x: box(0, 1) })).toMatchObject({
      kind: 'partial',
      value: { hi: Infinity },
    });
  });
});
