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
