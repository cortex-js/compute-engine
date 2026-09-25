import { ComputeEngine } from '../../src/compute-engine';

/**
 * `Open(x)` and `Closed(x)` mark the endpoints of an `Interval`. They are
 * defined operators (pure markers with no evaluation), not unknown heads.
 *
 * Before they were defined, an application of either inferred the opaque
 * effect set `any`, and that opacity spread to every expression over such an
 * interval: a seeded draw from `Interval(0, Open(1))` was judged impure, so a
 * symbol assigned that draw was never memoized and redrew its whole list on
 * every element read (Tycho consumer item 317).
 */

const ce = new ComputeEngine();

describe('Open and Closed endpoint markers', () => {
  test('are pure, defined, and inert', () => {
    const open = ce.box(['Open', 1]);
    const closed = ce.box(['Closed', 1]);
    expect(open.isPure).toBe(true);
    expect(closed.isPure).toBe(true);
    expect(open.isValid).toBe(true);
    expect(closed.isValid).toBe(true);
    // No evaluation: the marker stays as written.
    expect(open.evaluate().json).toEqual(['Open', 1]);
    expect(closed.evaluate().json).toEqual(['Closed', 1]);
  });

  test('an interval with an open endpoint is pure', () => {
    expect(ce.box(['Interval', 0, ['Open', 1]]).isPure).toBe(true);
    expect(ce.box(['Interval', ['Open', 0], ['Closed', 1]]).isPure).toBe(true);
    // An infinite endpoint is admitted: the open end of a ray.
    const ray = ce.box(['Interval', ['Open', 'NegativeInfinity'], 0]);
    expect(ray.isValid).toBe(true);
    expect(ray.isPure).toBe(true);
  });

  test('the LaTeX interval notation round-trips through the markers', () => {
    const expr = ce.parse('\\left]0,1\\right[');
    expect(expr.json).toEqual(['Interval', ['Open', 0], ['Open', 1]]);
    expect(ce.parse(expr.latex).json).toEqual(expr.json);
    expect(ce.parse('[0,1)').json).toEqual(['Interval', 0, ['Open', 1]]);
  });

  test('a seeded draw from an open interval is pure', () => {
    const draw = ce.box([
      'WithRandomSeed',
      312463,
      ['RandomChoice', ['Interval', 0, ['Open', 1]], 5],
    ]);
    // The draw itself consumes randomness…
    expect(draw.op2.isPure).toBe(false);
    // …and the seed frame discharges it: the framed draw is referentially
    // transparent, exactly as `WithRandomSeed(1, Random())` is.
    expect(draw.isPure).toBe(true);
    expect(ce.box(['WithRandomSeed', 1, ['Random']]).isPure).toBe(true);
  });

  test('a symbol assigned a seeded draw is memoized across element reads', () => {
    const engine = new ComputeEngine();
    engine.assign('N', 100);
    engine.assign(
      'A',
      engine.box([
        'Multiply',
        2,
        ['WithRandomSeed', 312463, ['RandomChoice', ['Interval', 0, ['Open', 1]], 'N']],
      ])
    );
    // Every read sees the same draw (the seed makes it deterministic)…
    const first = engine.parse('A[3]').evaluate();
    for (let i = 0; i < 5; i++)
      expect(engine.parse('A[3]').evaluate().isSame(first)).toBe(true);
    // …and the stored value is served from the memo rather than redrawn:
    // 2,000 reads of one element complete well within a second, where a
    // redraw of the 100-element list per read took tens of seconds on the
    // shape of item 317. The bound is loose on purpose (a shared machine).
    const t0 = performance.now();
    for (let i = 0; i < 2000; i++) engine.parse('A[3]').evaluate();
    expect(performance.now() - t0).toBeLessThan(5000);
  });
});
