/**
 * `Max`/`Min` with SCALAR and COLLECTION operands together, and the
 * coordinate accessors over a large written-out list of points.
 *
 * `Max` and `Min` are reducers: every collection operand is flattened into
 * the operand list, so `Min(1, L)` is the least of `1` and the elements of
 * `L` — one number, not a list (`ElementMin` is the element-wise form). The
 * interval target compiled the reduction of ONE collection and declined a
 * collection beside a scalar, which the interpreter and the JavaScript target
 * both answer.
 *
 * Found on the Tycho corpus document `s8ishknvhe`, whose colour row reduces a
 * coordinate of ten thousand points: `Min(1, 2 − 2·PointZ(C))`. In the
 * interpreter the cost of that row was the coordinate accessor, which turned a
 * written-out list of points into a lazy `Map` that applies `At` to every
 * point as a function.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { loadIdentities } from '../../src/identities';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

type Interval = { lo: number; hi: number };
const point = (v: number): Interval => ({ lo: v, hi: v });

describe('Max/Min of a scalar and a collection on the interval target', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('L', 'list<number>');
  ce.declare('C', 'list<tuple<number, number, number>>');

  /** Compile for `interval-js`, run on point intervals, answer the interval. */
  function run(json: unknown, vars: Record<string, unknown>): Interval {
    const r = compile(ce.box(json as never), { to: 'interval-js' });
    expect(r.success).toBe(true);
    const lift = (v: unknown): unknown =>
      Array.isArray(v) ? v.map(lift) : point(v as number);
    const out = r.run!(
      Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, lift(v)]))
    ) as unknown as { value?: Interval } & Interval;
    // An ordinary answer wraps its interval; the absence marker is a bare
    // interval of NaN bounds.
    return out.value ?? out;
  }

  /** The interpreter's number for the same expression and bindings. */
  function interpreted(json: unknown, bind: Record<string, unknown>): number {
    const bindings = Object.fromEntries(
      Object.entries(bind).map(([k, v]) => [k, ce.box(v as never)])
    );
    return Number(
      ce
        .box(json as never)
        .subs(bindings)
        .evaluate()
        .valueOf()
    );
  }

  test.each([
    ['Min(1, L)', ['Min', 1, 'L'], [0.5, 3, -2], -2],
    ['Max(0, L)', ['Max', 0, 'L'], [0.5, 3, -2], 3],
    ['Min(1, L), the scalar wins', ['Min', 1, 'L'], [4, 3], 1],
    ['Min(x, L)', ['Min', 'x', 'L'], [4, 3], 0.25],
    ['Max(0, Min(1, L))', ['Max', 0, ['Min', 1, 'L']], [0.5, 3], 0.5],
    ['Min(1, L, 2, x)', ['Min', 1, 'L', 2, 'x'], [4, 3], 0.25],
  ])('%s agrees with the interpreter', (_label, json, list, want) => {
    const got = run(json, { L: list, x: 0.25 });
    expect(got).toEqual(point(want as number));
    expect(
      interpreted(json, { L: ['List', ...(list as number[])], x: 0.25 })
    ).toBe(want);
  });

  test('an EMPTY list beside a scalar contributes nothing', () => {
    expect(run(['Min', 1, 'L'], { L: [] })).toEqual(point(1));
    expect(run(['Max', 0, 'L'], { L: [] })).toEqual(point(0));
    expect(interpreted(['Min', 1, 'L'], { L: ['List'] })).toBe(1);
    // A lone empty list is still the absence marker.
    expect(run(['Min', 'L'], { L: [] }).lo).toBeNaN();
  });

  test('a NaN element absorbs', () => {
    expect(run(['Min', 1, 'L'], { L: [NaN, 2] }).lo).toBeNaN();
    expect(interpreted(['Min', 1, 'L'], { L: ['List', 'NaN', 2] })).toBeNaN();
  });

  test('a written-out list beside a scalar is folded element by element', () => {
    const r = compile(ce.box(['Min', 1, ['List', 'x', 2, 3]] as never), {
      to: 'interval-js',
    });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('reduce');
    expect(run(['Min', 1, ['List', 'x', 2, 3]], { x: 0.25 })).toEqual(
      point(0.25)
    );
  });

  test('the reduction of a coordinate of a list of points', () => {
    const json = ['Min', 1, ['Subtract', 2, ['Multiply', 2, ['PointZ', 'C']]]];
    const points = [
      [0, 0, 0.25],
      [1, 1, 0.9],
      [2, 2, 0.5],
    ];
    const got = run(json, { C: points });
    const want = interpreted(json, {
      C: ['List', ...points.map((p) => ['Tuple', ...p])],
    });
    // The interpreter computes in 21 digits and the kernel in doubles, so
    // the two agree to rounding, not to the last bit.
    expect(want).toBeCloseTo(0.2, 12);
    expect(got.lo).toBeCloseTo(want, 12);
    expect(got.hi).toBeCloseTo(want, 12);
  });

  test('two collections and no scalar: the absence marker only when both are empty', () => {
    ce.declare('M', 'list<number>');
    const json = ['Min', 'L', 'M'];
    expect(run(json, { L: [4, 3], M: [5, -1] })).toEqual(point(-1));
    expect(run(json, { L: [], M: [5, -1] })).toEqual(point(-1));
    expect(run(json, { L: [4, 3], M: [] })).toEqual(point(3));
    expect(run(json, { L: [], M: [] }).lo).toBeNaN();
    expect(interpreted(json, { L: ['List'], M: ['List', 5, -1] })).toBe(-1);
    expect(interpreted(json, { L: ['List'], M: ['List'] })).toBeNaN();
  });

  test('a run-time range that is empty beside a scalar contributes nothing', () => {
    // `Range(n, 5, 0)` has a zero step, so it is empty whatever `n` is, and
    // its bound is symbolic, so it is reduced by the run-time range loop.
    ce.declare('n', 'integer');
    const json = ['Min', 1, ['Range', 'n', 5, 0]];
    expect(run(json, { n: 2 })).toEqual(point(1));
    expect(interpreted(['Min', 1, ['Range', 2, 5, 0]], {})).toBe(1);
    // A range that is not empty is reduced as before.
    expect(run(['Min', 10, ['Range', 'n', 5]], { n: 2 })).toEqual(point(2));
  });
});

describe('A coordinate accessor over a large written-out list of points', () => {
  const N = 250; // Above the size at which a broadcast turns lazy.
  const ce = new ComputeEngine();
  const points = Array.from({ length: N }, (_, i) => [
    'Tuple',
    i,
    2 * i,
    i / 4,
  ]);

  test('reads the coordinates off the points, as a list', () => {
    const z = ce.box(['PointZ', ['List', ...points]] as never).evaluate();
    expect(z.operator).toBe('List');
    expect(z.nops).toBe(N);
    expect(z.ops![0].re).toBe(0);
    expect(z.ops![N - 1].re).toBe((N - 1) / 4);
    // The same through a symbol that holds the list.
    ce.assign('C', ce.box(['List', ...points] as never));
    const y = ce.box(['PointY', 'C']).evaluate();
    expect(y.operator).toBe('List');
    expect(y.ops![N - 1].re).toBe(2 * (N - 1));
  });

  test('a reduction over a coordinate agrees with the direct computation', () => {
    ce.assign('C', ce.box(['List', ...points] as never));
    const got = ce
      .box(['Min', 1, ['Subtract', 2, ['Multiply', 2, ['PointZ', 'C']]]])
      .evaluate();
    const want = Math.min(1, ...points.map((p) => 2 - 2 * (p[3] as number)));
    expect(Number(got.valueOf())).toBe(want);
  });

  test('a LAZY source of points stays lazy', () => {
    // A `Map` over a long `Range` is not in memory, so there is something
    // for laziness to save.
    const lazyPoints = [
      'Map',
      ['Function', ['Tuple', 'k', ['Multiply', 2, 'k']], 'k'],
      ['Range', 1, 100000],
    ];
    const x = ce.box(['PointX', lazyPoints] as never).evaluate();
    expect(x.operator).not.toBe('List');
    expect(x.at!(3)?.re).toBe(3);
  });
});

describe('simplify() keeps the head of an extremum over one collection', () => {
  // `Max`, `Min`, `Supremum` and `Infimum` reduce a collection operand to a
  // number. A simplification rule rewrote the extremum of ONE operand to the
  // operand, which is right for a scalar only: `Min(Map(Sin, RealNumbers))`
  // became the `Map` itself, a list where a number is meant, and the Fungrim
  // identity for that minimum never saw its head.
  const local = new ComputeEngine();
  const sinOverReals = ['Map', ['Function', ['Sin', 'x'], 'x'], 'RealNumbers'];

  test.each(['Max', 'Min', 'Supremum', 'Infimum'])(
    '%s of a collection operand',
    (head) => {
      expect(local.box([head, sinOverReals] as never).simplify().operator).toBe(
        head
      );
      expect(
        local.box([head, ['Range', 1, 'n']] as never).simplify().operator
      ).toBe(head);
    }
  );

  // A symbol with no declared type can be given a list later, and the
  // simplified form must then still reduce it.
  test('an operand of unknown type keeps its head', () => {
    const fresh = new ComputeEngine();
    const simplified = fresh.box(['Max', 'u']).simplify();
    expect(simplified.json).toEqual(['Max', 'u']);
    fresh.assign('u', fresh.box(['List', 1, 2, 3]));
    expect(simplified.evaluate().json).toEqual(3);
  });

  // The operator names are compared one by one. A lookup in an object
  // literal also answers for the names every object inherits.
  test('an application named like an inherited property is left alone', () => {
    expect(local.box(['toString', 5] as never).simplify().json).toEqual([
      'toString',
      5,
    ]);
    expect(local.box(['constructor'] as never).simplify().json).toEqual([
      'constructor',
    ]);
  });

  test('a scalar operand is still its own extremum', () => {
    expect(local.box(['Max', 5]).simplify().json).toEqual(5);
    expect(local.box(['Min', ['Sqrt', 2]]).simplify().json).toEqual([
      'Sqrt',
      2,
    ]);
    local.declare('r', 'real');
    expect(local.box(['Max', 'r']).simplify().json).toEqual('r');
  });

  test('with the Fungrim identities the minimum of sin over the reals is -1', () => {
    const withRules = new ComputeEngine();
    loadIdentities(withRules);
    expect(withRules.box(['Min', sinOverReals] as never).simplify().json).toBe(
      -1
    );
  });
});
