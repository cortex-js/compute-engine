import {
  ComputeEngine,
  compile,
  INTERVAL_KIND,
} from '../../src/compute-engine';
import {
  INTERVAL_KIND as INTERVAL_KIND_FROM_INTERVAL_ENTRY,
  INTERVAL_RUNTIME_VERSION,
  encodeIntervalResult,
} from '../../src/interval';

// `result.broadcast(inputs, options)`: evaluate a compiled function at many
// points in one call (design: docs/plans/2026-10-20-worker-kernel-pool.md,
// section 5.4; the encoding and the rules are in
// src/compute-engine/compilation/broadcast.ts). The contract tested here is
// parity with `run()` cell for cell, the two input layouts, the per-batch
// scalar, the caller-owned output array, and the interval kind codes.

const ce = new ComputeEngine();

/** `n` cells over `[lo, hi]`, one value each. */
function samples(n: number, lo = -5, hi = 5): Float64Array {
  const xs = new Float64Array(n);
  for (let i = 0; i < n; i++) xs[i] = lo + ((hi - lo) * i) / (n - 1);
  return xs;
}

/** `n` cells over `[lo, hi]`, as `lo, hi` pairs that tile the range. */
function cells(n: number, lo = -3, hi = 3): Float64Array {
  const xs = new Float64Array(2 * n);
  for (let i = 0; i < n; i++) {
    xs[2 * i] = lo + ((hi - lo) * i) / n;
    xs[2 * i + 1] = lo + ((hi - lo) * (i + 1)) / n;
  }
  return xs;
}

describe('broadcast on a javascript result', () => {
  test('gives the value run() gives, cell for cell', () => {
    const xs = samples(1000);
    // The number `broadcast` writes for a `run()` value: a real as it is, a
    // boolean as 1 or 0, anything else (a complex value with a non-zero
    // imaginary part, as `\sqrt{x}` gives for a negative `x`) as NaN.
    const asNumber = (v: unknown): number =>
      typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : NaN;
    for (const latex of [
      '\\sin(x^2)+\\cos(3x)/(1+x^2)',
      'x^3 - 2x + 1',
      '\\frac{1}{x}',
      '\\sqrt{x}',
    ]) {
      const r = compile(ce.parse(latex));
      const out = r.broadcast!({ x: xs });
      expect(out).toHaveLength(1000);
      for (let i = 0; i < xs.length; i++)
        expect(Object.is(out[i], asNumber(r.run({ x: xs[i] })))).toBe(true);
    }
  });

  test('a boolean result is 1 or 0', () => {
    const r = compile(ce.parse('x > 1'));
    expect(
      Array.from(r.broadcast!({ x: new Float64Array([0, 1, 2]) }))
    ).toEqual([0, 0, 1]);
  });

  test('a number input is the same value for every cell', () => {
    const r = compile(ce.parse('x + a'));
    expect(
      Array.from(r.broadcast!({ x: new Float64Array([1, 2, 3]), a: 10 }))
    ).toEqual([11, 12, 13]);
  });

  test('scalars only make one cell', () => {
    const r = compile(ce.parse('x + a'));
    expect(Array.from(r.broadcast!({ x: 1, a: 2 }))).toEqual([3]);
  });

  test('the grid layout takes the arrays as axes, the first varying fastest', () => {
    const r = compile(ce.parse('x + 10 y'));
    const out = r.broadcast!(
      { x: new Float64Array([1, 2, 3]), y: new Float64Array([0, 1]) },
      { layout: 'grid' }
    );
    expect(Array.from(out)).toEqual([1, 2, 3, 11, 12, 13]);
  });

  test('a scalar in a grid layout is not an axis', () => {
    const r = compile(ce.parse('x + 10 y + 100 a'));
    const out = r.broadcast!(
      { x: new Float64Array([1, 2]), a: 1, y: new Float64Array([0, 1]) },
      { layout: 'grid' }
    );
    expect(Array.from(out)).toEqual([101, 102, 111, 112]);
  });

  test('a caller-owned output array is filled and returned', () => {
    const r = compile(ce.parse('2x'));
    const out = new Float64Array(5);
    const back = r.broadcast!({ x: new Float64Array([1, 2, 3]) }, { out });
    expect(back).toBe(out);
    expect(Array.from(out)).toEqual([2, 4, 6, 0, 0]);
  });

  test('an output array that is too short throws', () => {
    const r = compile(ce.parse('2x'));
    expect(() =>
      r.broadcast!(
        { x: new Float64Array([1, 2, 3]) },
        { out: new Float64Array(2) }
      )
    ).toThrow(/output array/);
  });

  test('arrays of different cell counts throw', () => {
    const r = compile(ce.parse('x + y'));
    expect(() =>
      r.broadcast!({ x: new Float64Array([1, 2, 3]), y: new Float64Array([1]) })
    ).toThrow(/holds 1 cells, the first array 3/);
  });

  test('an input that is neither an array nor a number throws', () => {
    const r = compile(ce.parse('2x'));
    expect(() =>
      r.broadcast!({ x: [1, 2] as unknown as Float64Array })
    ).toThrow(/Float64Array or a number/);
  });

  test('a real given to a complex-declared symbol is lifted, as run() does', () => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    const r = compile(engine.parse('z^2 + 1'));
    expect(Array.from(r.broadcast!({ z: new Float64Array([2, 3]) }))).toEqual([
      5, 10,
    ]);
    expect(r.run({ z: 2 })).toBe(5);
  });

  test('a cell whose result is not a real number is NaN', () => {
    const engine = new ComputeEngine();
    engine.declare('z', 'complex');
    // The square root of a negative real is complex with a non-zero
    // imaginary part: no real value for that cell.
    const r = compile(engine.parse('\\sqrt{z}'));
    const out = r.broadcast!({ z: new Float64Array([4, -4]) });
    expect(out[0]).toBe(2);
    expect(Number.isNaN(out[1])).toBe(true);
  });

  test('a symbol the code reads as a list cannot be broadcast', () => {
    const engine = new ComputeEngine();
    engine.declare('L', 'list<number>');
    const r = compile(engine.parse('\\mathrm{Sum}(L)'));
    expect(() => r.broadcast!({ L: new Float64Array([1, 2]) })).toThrow(
      /read as a list/
    );
  });

  test('a lambda result (positional arguments) has no broadcast', () => {
    const r = compile(ce.parse('x \\mapsto 2x'));
    expect(r.calling).toBe('lambda');
    expect(r.broadcast).toBeUndefined();
  });
});

describe('broadcast on an interval-js result', () => {
  const kindsOf = (out: Float64Array): number[] => {
    const kinds: number[] = [];
    for (let i = 2; i < out.length; i += 3) kinds.push(out[i]);
    return kinds;
  };

  test('the result carries the interval runtime version', () => {
    const r = compile(ce.parse('\\sin(x)'), { to: 'interval-js' });
    expect(r.runtimeVersion).toBe(INTERVAL_RUNTIME_VERSION);
    expect(typeof r.runtimeVersion).toBe('string');
  });

  test('gives the enclosure run() gives, cell for cell, as lo, hi, kind triples', () => {
    const xs = cells(600);
    for (const latex of [
      '\\sin(x)/x',
      '\\sin(x^2)+\\cos(3x)/(1+x^2)',
      '\\sqrt{x}',
      '\\lfloor x \\rfloor',
    ]) {
      const r = compile(ce.parse(latex), { to: 'interval-js' });
      const out = r.broadcast!({ x: xs });
      expect(out).toHaveLength(3 * 600);
      for (let i = 0; i < 600; i++) {
        const v = r.run({ x: { lo: xs[2 * i], hi: xs[2 * i + 1] } }) as {
          kind: string;
          value?: { lo: number; hi: number };
        };
        const lo = v.value?.lo ?? NaN;
        const hi = v.value?.hi ?? NaN;
        expect(Object.is(out[3 * i], lo)).toBe(true);
        expect(Object.is(out[3 * i + 1], hi)).toBe(true);
        if (v.kind === 'interval')
          expect(out[3 * i + 2]).toBe(INTERVAL_KIND.interval);
      }
    }
  });

  test('the kind codes: interval, empty, singular pole, singular jump, partial', () => {
    const one = (latex: string, lo: number, hi: number): number[] => {
      const r = compile(ce.parse(latex), { to: 'interval-js' });
      return Array.from(r.broadcast!({ x: new Float64Array([lo, hi]) }));
    };
    expect(one('x^2', 1, 2)).toEqual([1, 4, INTERVAL_KIND.interval]);
    expect(one('\\sqrt{x}', -2, -1).slice(2)).toEqual([INTERVAL_KIND.empty]);
    expect(one('1/x', -1, 1).slice(2)).toEqual([INTERVAL_KIND.singularPole]);
    expect(one('\\lfloor x \\rfloor', 0.5, 1.5)).toEqual([
      0,
      1,
      INTERVAL_KIND.singularJump,
    ]);
    expect(one('\\sqrt{x}', -1, 4)).toEqual([0, 2, INTERVAL_KIND.partial]);
  });

  test('a half-infinite bound is an ordinary interval', () => {
    const r = compile(ce.parse('x^3'), { to: 'interval-js' });
    const out = r.broadcast!({
      x: new Float64Array([-Infinity, 1, 0, Infinity]),
    });
    expect(Array.from(out)).toEqual([
      -Infinity,
      1,
      INTERVAL_KIND.interval,
      0,
      Infinity,
      INTERVAL_KIND.interval,
    ]);
    // The logarithm at zero is clipped at its lower bound: a `partial` whose
    // enclosure is half-infinite.
    const ln = compile(ce.parse('\\ln(x)'), { to: 'interval-js' });
    expect(Array.from(ln.broadcast!({ x: new Float64Array([0, 1]) }))).toEqual([
      -Infinity,
      0,
      INTERVAL_KIND.partial,
    ]);
  });

  test('a compiled comparison gives the three boolean kinds', () => {
    const r = compile(ce.parse('x > 1'), { to: 'interval-js' });
    const out = r.broadcast!({ x: new Float64Array([2, 3, -1, 0, 0, 2]) });
    expect(kindsOf(out)).toEqual([
      INTERVAL_KIND.boolTrue,
      INTERVAL_KIND.boolFalse,
      INTERVAL_KIND.boolMaybe,
    ]);
    expect(Number.isNaN(out[0])).toBe(true);
  });

  test('a number input is the point interval for every cell', () => {
    const r = compile(ce.parse('x + a'), { to: 'interval-js' });
    const out = r.broadcast!({ x: new Float64Array([1, 2, 3, 4]), a: 10 });
    expect(Array.from(out)).toEqual([
      11,
      12,
      INTERVAL_KIND.interval,
      13,
      14,
      INTERVAL_KIND.interval,
    ]);
  });

  test('the grid layout and a reused output array', () => {
    const r = compile(ce.parse('x + 10 y'), { to: 'interval-js' });
    const out = new Float64Array(3 * 4);
    const back = r.broadcast!(
      { x: new Float64Array([1, 1, 2, 2]), y: new Float64Array([0, 0, 1, 1]) },
      { layout: 'grid', out }
    );
    expect(back).toBe(out);
    expect(Array.from(out)).toEqual([1, 1, 0, 2, 2, 0, 11, 11, 0, 12, 12, 0]);
  });

  test('an array whose length is odd throws', () => {
    const r = compile(ce.parse('x'), { to: 'interval-js' });
    expect(() => r.broadcast!({ x: new Float64Array([1, 2, 3]) })).toThrow(
      /lo, hi pairs/
    );
  });
});

describe('encodeIntervalResult', () => {
  const enc = (r: unknown): number[] => {
    const out = new Float64Array(3);
    encodeIntervalResult(r, out, 0);
    return Array.from(out);
  };

  test('a bare enclosure is an interval; a NaN lower bound is the absent marker', () => {
    expect(enc({ lo: 1, hi: 2 })).toEqual([1, 2, INTERVAL_KIND.interval]);
    expect(enc({ lo: NaN, hi: NaN }).slice(2)).toEqual([INTERVAL_KIND.empty]);
    expect(
      enc({ kind: 'interval', value: { lo: NaN, hi: 1 } }).slice(2)
    ).toEqual([INTERVAL_KIND.empty]);
  });

  test('reversed or non-numeric bounds, an unknown kind and a non-result are errors', () => {
    expect(enc({ lo: 2, hi: 1 }).slice(2)).toEqual([INTERVAL_KIND.error]);
    expect(
      enc({ kind: 'interval', value: { lo: 1, hi: 'x' } }).slice(2)
    ).toEqual([INTERVAL_KIND.error]);
    expect(enc({ kind: 'somethingElse' }).slice(2)).toEqual([
      INTERVAL_KIND.error,
    ]);
    expect(enc(undefined).slice(2)).toEqual([INTERVAL_KIND.error]);
    expect(enc('perhaps').slice(2)).toEqual([INTERVAL_KIND.error]);
  });

  test('entire, and a singular result with or without a value', () => {
    expect(enc({ kind: 'entire' }).slice(2)).toEqual([INTERVAL_KIND.entire]);
    expect(enc({ kind: 'singular', at: 0 }).slice(2)).toEqual([
      INTERVAL_KIND.singularPole,
    ]);
    // No usable enclosure: a pole, not `empty` (run() keeps it singular).
    expect(
      enc({ kind: 'singular', value: { lo: NaN, hi: 1 } }).slice(2)
    ).toEqual([INTERVAL_KIND.singularPole]);
    expect(
      enc({
        kind: 'singular',
        at: 1,
        continuity: 'right',
        value: { lo: 0, hi: 1 },
      })
    ).toEqual([0, 1, INTERVAL_KIND.singularJump]);
  });

  test('the kind codes are the same object from both entry points', () => {
    expect(INTERVAL_KIND_FROM_INTERVAL_ENTRY).toBe(INTERVAL_KIND);
  });
});
