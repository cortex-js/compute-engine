import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  rangeCount,
  RANGE_COUNT_JS_SOURCE,
} from '../../src/compute-engine/numerics/range-count';

// The element count of an arithmetic `Range` is `floor((upper − lower) /
// step) + 1`. The quotient is a float, and an end point that lies on the step
// grid in exact arithmetic can fall one rounding error short of it:
// `0.3 / 0.1` is 2.9999999999999996, and `(2 − 2/500)π ÷ (2π/500)` is
// 498.99999999999994. Those ranges must count their end point (4 and 500
// elements), on every route: the interpreter, and the `javascript`,
// `interval-js` and `python` compile targets.

const ce = new ComputeEngine();

const WITNESS = '[0,\\frac{2}{d}\\pi...(2-\\frac{2}{d})\\pi]';

function count(latex: string): number | undefined {
  return ce.parse(latex).evaluate().count;
}

describe('RANGE COUNT: END POINT ON THE STEP GRID', () => {
  // The engine is shared, so `d` is assigned in the parse-route tests only
  // (`beforeAll` of this block) and the compile tests with a free `d` use a
  // separate engine.
  const e = new ComputeEngine();
  beforeAll(() => e.assign('d', 500));

  test('the parse-route witness has 500 elements', () => {
    const expr = e.parse(WITNESS);
    const value = expr.evaluate();
    expect(value.count).toBe(500);
    const last = value.at(-1)!.N().re;
    expect(Math.abs(last - 1.996 * Math.PI)).toBeLessThan(1e-12);
  });

  test('Length, Last and At agree with the count', () => {
    const range = e.parse(WITNESS).json;
    expect(e.box(['Length', range]).evaluate().re).toBe(500);
    const last = e.box(['Last', range]).evaluate().N().re;
    expect(Math.abs(last - 1.996 * Math.PI)).toBeLessThan(1e-12);
    const at500 = e.box(['At', range, 500]).evaluate().N().re;
    expect(at500).toBe(last);
    // One past the end is not an element.
    expect(e.box(['At', range, 501]).evaluate().re).toBeNaN();
  });

  test('the range contains its own last element', () => {
    const range = e.parse(WITNESS);
    const last = range.evaluate().at(-1)!;
    expect(e.box(['Element', last, range]).evaluate().symbol).toBe('True');
  });

  test('Range(0, 0.3, 0.1) has 4 elements', () => {
    expect(count('[0,0.1...0.3]')).toBe(4);
    expect(ce.box(['Range', 0, 0.3, 0.1]).count).toBe(4);
    expect(ce.box(['Max', ['Range', 0, 0.3, 0.1]]).evaluate().re).toBeCloseTo(
      0.3,
      15
    );
  });

  test('a unit-step range whose span is one rounding error short of 1', () => {
    // 2.3 − 1.3 is 0.9999999999999998.
    expect(ce.box(['Range', 1.3, 2.3]).count).toBe(2);
  });
});

describe('RANGE COUNT: UNCHANGED RANGES', () => {
  test('the count is not rounded to the nearest integer', () => {
    // Desmos rounds the count to the nearest integer; the Compute Engine
    // stops at the last grid point at or before the upper bound.
    expect(ce.box(['Range', 0, 2.5, 1]).count).toBe(3);
    expect(ce.box(['Range', 1, 10, 4]).count).toBe(3);
    expect(ce.box(['Range', 1, 10, 4]).evaluate().toString()).toBe(
      '[1,5,9]'
    );
  });

  test('empty ranges', () => {
    expect(ce.box(['Range', 5, 1, 1]).count).toBe(0);
    expect(ce.box(['Range', 1, 5, -1]).count).toBe(0);
    expect(ce.box(['Range', 1, 5, 0]).count).toBe(0);
  });

  test('negative-step ranges', () => {
    expect(ce.box(['Range', 5, 1, -1]).count).toBe(5);
    expect(ce.box(['Range', 5, 1, -1]).evaluate().toString()).toBe(
      '[5,4,3,2,1]'
    );
    expect(ce.box(['Range', 0.3, 0, -0.1]).count).toBe(4);
  });

  test('an integer range with a large span is counted exactly', () => {
    // 3·10¹² − 1 is not on the grid of step 3 from 0: the last element is
    // 3·10¹² − 3, and there are 10¹² elements. A tolerance proportional to
    // the quotient would add one.
    expect(rangeCount(0, 3e12 - 1, 3)).toBe(1e12);
    expect(ce.box(['Range', 0, 3e12 - 1, 3]).count).toBe(1e12);
  });

  test('the tolerance never reaches a step, however large the quotient', () => {
    // The quotient is 10¹² + 0.2: the end point is a fifth of a step past the
    // grid, so the range has 10¹² + 1 elements. An uncapped tolerance of
    // 10⁻¹² of the quotient would be a whole step here and count one more.
    expect(rangeCount(0, 1e9 + 0.0002, 0.001)).toBe(1e12 + 1);
    expect(ce.box(['Range', 0, 1e9 + 0.0002, 0.001]).count).toBe(1e12 + 1);
    const fn = new Function(`return ${RANGE_COUNT_JS_SOURCE};`)() as (
      a: number,
      b: number,
      s: number
    ) => number;
    expect(fn(0, 1e9 + 0.0002, 0.001)).toBe(1e12 + 1);
    // The cap still absorbs the rounding of a quotient that is an integer in
    // exact arithmetic: 10⁹ / 0.001 evaluates to exactly 10¹² here, and a
    // quotient a few units in the last place below it is counted the same.
    const q = 1e12;
    const belowGrid = q * (1 - 4 * Number.EPSILON);
    expect(Math.floor(belowGrid)).toBeLessThan(q);
    expect(rangeCount(0, belowGrid * 0.001, 0.001)).toBe(q + 1);
  });
});

describe('RANGE COUNT: HELPER', () => {
  const cases: [number, number, number][] = [
    [0, 0.3, 0.1],
    [0, ((2 - 2 / 500) * Math.PI) as number, (2 * Math.PI) / 500],
    [0, 2.5, 1],
    [1, 10, 4],
    [5, 1, -1],
    [5, 1, 1],
    [1, 5, 0],
    [1, 5, -Infinity],
    [1, Infinity, 1],
    [-Infinity, 1, 1],
    [NaN, 5, 1],
    [0, 3e12 - 1, 3],
    [1.3, 2.3, 1],
  ];

  test('rangeCount', () => {
    expect(cases.map(([a, b, s]) => rangeCount(a, b, s))).toEqual([
      4, 500, 3, 3, 5, 0, 0, 1, Infinity, Infinity, NaN, 1e12, 2,
    ]);
  });

  test('the emitted JavaScript source agrees with rangeCount', () => {
    const fn = new Function(`return ${RANGE_COUNT_JS_SOURCE};`)() as (
      a: unknown,
      b: unknown,
      s: unknown
    ) => number;
    for (const [a, b, s] of cases) expect(fn(a, b, s)).toBe(rangeCount(a, b, s));
    // A missing run-time variable reads as NaN, as the arithmetic does.
    expect(fn(undefined, 5, 1)).toBeNaN();
    expect(rangeCount(undefined as unknown as number, 5, 1)).toBeNaN();
  });
});

describe('RANGE COUNT: COMPILE ROUTES', () => {
  const lengthOfWitness = (engine: ComputeEngine) =>
    engine.box(['Length', engine.parse(WITNESS).json]);

  test('javascript, with d a free variable passed at run time', () => {
    const e = new ComputeEngine();
    const fn = compile(lengthOfWitness(e), { to: 'javascript' });
    expect(fn.success).toBe(true);
    expect(fn.run!({ d: 500 })).toBe(500);
  });

  test('javascript, with d assigned', () => {
    const e = new ComputeEngine();
    e.assign('d', 500);
    const fn = compile(lengthOfWitness(e), { to: 'javascript' });
    expect(fn.success).toBe(true);
    expect(fn.run!({})).toBe(500);
  });

  test('javascript, the materialized range', () => {
    const e = new ComputeEngine();
    const fn = compile(e.box(['Range', 0, 'h', 's']), { to: 'javascript' });
    expect(fn.success).toBe(true);
    const v = fn.run!({ h: 0.3, s: 0.1 }) as number[];
    expect(v.length).toBe(4);
    // A zero or sign-mismatched step at run time is the empty range, as in
    // the interpreter.
    expect(fn.run!({ h: 0.3, s: 0 })).toEqual([]);
    expect(fn.run!({ h: 0.3, s: -0.1 })).toEqual([]);
  });

  test('javascript, a counted loop over the range', () => {
    const e = new ComputeEngine();
    const fn = compile(
      e.box([
        'Comprehension',
        'k',
        ['Element', 'k', ['Range', 'lo', 'hi', 'step']],
      ]),
      { to: 'javascript', constantFold: false }
    );
    expect(fn.success).toBe(true);
    const v = fn.run!({
      lo: 0,
      hi: (2 - 2 / 500) * Math.PI,
      step: (2 * Math.PI) / 500,
    }) as number[];
    expect(v.length).toBe(500);
    expect((fn.run!({ lo: 0, hi: 0.3, step: 0.1 }) as number[]).length).toBe(
      4
    );
  });

  test('interval-js, with point bounds at run time', () => {
    const e = new ComputeEngine();
    const fn = compile(e.box(['Length', ['Range', 'lo', 'hi', 'step']]), {
      to: 'interval-js',
    });
    expect(fn.success).toBe(true);
    const r = fn.run!({
      lo: 0,
      hi: (2 - 2 / 500) * Math.PI,
      step: (2 * Math.PI) / 500,
    }) as { kind: string; value: { lo: number; hi: number } };
    expect(r.kind).toBe('interval');
    expect(r.value).toEqual({ lo: 500, hi: 500 });
    const s = fn.run!({ lo: 0, hi: 0.3, step: 0.1 }) as {
      value: { lo: number; hi: number };
    };
    expect(s.value).toEqual({ lo: 4, hi: 4 });
  });

  test('interval-js, the witness with d free and with d assigned', () => {
    // The bounds involve π, so they are not point intervals: the length of
    // the range is then not a single number, and the interval route answers
    // `entire` ("cannot bound this"). It must not answer 499.
    const e = new ComputeEngine();
    const free = compile(lengthOfWitness(e), { to: 'interval-js' });
    expect(free.success).toBe(true);
    expect(free.run!({ d: 500 })).toEqual({ kind: 'entire' });
    e.assign('d', 500);
    const assigned = compile(lengthOfWitness(e), { to: 'interval-js' });
    expect(assigned.success).toBe(true);
    expect(assigned.run!({})).toEqual({ kind: 'entire' });
  });

  test('python emission uses the tolerance', () => {
    const e = new ComputeEngine();
    const fn = compile(e.box(['Range', 0, 'h', 's']), { to: 'python' });
    expect(fn.success).toBe(true);
    expect(fn.code).toContain('1e-12 * (1 + abs(_q))');
    const unit = compile(e.box(['Range', 'a', 'b']), { to: 'python' });
    expect(unit.code).toContain('1e-12 * (1 + abs(_q))');
  });
});
