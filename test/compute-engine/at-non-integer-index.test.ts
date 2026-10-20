/**
 * A scalar index that is provably NOT an integer — a non-integer float or
 * rational, an exact constant such as `5 + √17` — selects no element. `At`
 * answers the absence marker for it (`NaN` over a numeric collection,
 * `Missing` otherwise), as it does for an out-of-range integer, instead of
 * staying inert. An inert `At` embeds its collection whole: a helper whose
 * body reads `l[i + √Length(l)]` over a length that is not a perfect square
 * produced elements that each held an inert read of the level below, and
 * four levels of that never finished evaluating.
 *
 * An index the numeric reading cannot decide — a symbol with no value, an
 * expression with unknowns, an exact constant within rounding of an
 * integer — is left alone, as before. An infinite or NaN index names no
 * position and answers the marker, as a scalar and as an entry of an index
 * list.
 */

import { ComputeEngine } from '../../src/compute-engine';

describe('At over a provably non-integer scalar index', () => {
  const ce = new ComputeEngine();
  ce.assign('L', ce.box(['List', 10, 20, 30, 40, 50, 60, 70, 80, 90]));
  ce.assign('S', ce.box(['List', { str: 'a' }, { str: 'b' }, { str: 'c' }]));
  const ev = (latex: string) => ce.parse(latex).evaluate().toString();

  test('a non-integer float or rational answers the marker', () => {
    expect(ev('L[2.5]')).toBe('NaN');
    expect(ev('L[3/2]')).toBe('NaN');
    expect(ev('L[-0.5]')).toBe('NaN');
    // A literal decides exactly, with no margin: within a hair of an
    // integer, or so large that any margin would swallow the fraction.
    expect(ev('L[1.0000000001]')).toBe('NaN');
    expect(ev('L[1000000000.5]')).toBe('NaN');
  });

  test('an exact irrational constant answers the marker', () => {
    expect(ev('L[5+\\sqrt{17}]')).toBe('NaN');
    expect(ev('L[\\pi]')).toBe('NaN');
    expect(ev('L[-\\sqrt{2}]')).toBe('NaN');
  });

  test('the marker follows the element domain', () => {
    expect(ev('S[2.5]')).toBe('"Missing"');
  });

  test('an exact constant that IS an integer still selects', () => {
    expect(ev('L[\\sqrt{4}]')).toBe('20');
  });

  test('an exact constant within rounding of an integer stays inert', () => {
    // `((1 + √5)/2)² − (1 + √5)/2` is exactly 1, but the canonical form does
    // not reduce to it; the numeric reading cannot prove a non-integer, so
    // the read is left alone rather than answered by a float.
    const e = ce.parse(
      'L[\\frac{1+\\sqrt{5}}{2}\\cdot\\frac{1+\\sqrt{5}}{2}-\\frac{1+\\sqrt{5}}{2}]'
    );
    expect(e.evaluate().operator).toBe('At');
    expect(e.N().toString()).toBe('10');
  });

  test('an undecidable index stays inert', () => {
    expect(ev('L[x+1]')).toMatch(/^At\(/);
  });

  test('an infinite index names no position', () => {
    expect(ev('L[\\infty]')).toBe('NaN');
  });

  test('a chained read absorbs into the final domain', () => {
    ce.assign('M', ce.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    // The chained form `At(M, 1.5, 1)` absorbs into the final position's
    // domain (a number). The nested parse `M[1.5][1]` reads the marker of
    // the outer list's element domain first, a list, and so answers
    // `Missing` — exactly as the out-of-range `M[7][1]` does.
    expect(ce.box(['At', 'M', 1.5, 1]).evaluate().toString()).toBe('NaN');
    expect(ce.box(['At', 'M', 1, 1.5]).evaluate().toString()).toBe('NaN');
    expect(ev('M[1.5][1]')).toBe(ev('M[7][1]'));
    expect(ev('M[1][1.5]')).toBe('NaN');
  });
});

describe('At over a gather with a provably non-integer entry', () => {
  const ce = new ComputeEngine();
  ce.assign('L', ce.box(['List', 10, 20, 30]));

  test('the entry contributes the marker in place', () => {
    expect(ce.parse('L[[1, 2.5, 3]]').evaluate().toString()).toBe(
      '[10,NaN,30]'
    );
  });

  test('an undecidable entry keeps the gather inert', () => {
    expect(ce.parse('L[[1, x, 3]]').evaluate().operator).toBe('At');
  });
});

describe('At over a gather with a NaN or infinite entry', () => {
  // A NaN or infinite entry of an index list names no position. It gives the
  // hole the scalar index gives, in its own slot, and the other entries are
  // read as usual (Tycho ledger row 401). The hole is the one an out-of-range
  // entry gives: `NaN` over numbers, `Missing` over points.
  const ce = new ComputeEngine();
  const ev = (json: any) => ce.box(json).evaluate().json;
  const P = ['List', 10, 20, 30];
  const T = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];

  test('the reference holes: scalar NaN and out-of-range entry', () => {
    expect(ev(['At', P, 'NaN'])).toEqual('NaN');
    expect(ev(['At', P, ['List', 0, 1]])).toEqual(['List', 'NaN', 10]);
    expect(ev(['At', T, 'NaN'])).toEqual('Missing');
    expect(ev(['At', T, ['List', 0, 1]])).toEqual([
      'List',
      'Missing',
      ['Tuple', 1, 2],
    ]);
  });

  test('a NaN entry over numbers', () => {
    expect(ev(['At', P, ['List', 'NaN', 1]])).toEqual(['List', 'NaN', 10]);
    expect(ev(['At', P, ['List', ['Divide', 0, 0], 1]])).toEqual([
      'List',
      'NaN',
      10,
    ]);
  });

  test('an infinite entry over numbers', () => {
    expect(ev(['At', P, ['List', 'PositiveInfinity', 1]])).toEqual([
      'List',
      'NaN',
      10,
    ]);
    expect(ev(['At', P, ['List', 'NegativeInfinity', 2.5]])).toEqual([
      'List',
      'NaN',
      'NaN',
    ]);
    expect(ev(['At', P, ['List', 3, 'ComplexInfinity']])).toEqual([
      'List',
      30,
      'NaN',
    ]);
  });

  test('a NaN entry over points', () => {
    expect(ev(['At', T, ['List', 'NaN', 1]])).toEqual([
      'List',
      'Missing',
      ['Tuple', 1, 2],
    ]);
  });

  test('the parse route', () => {
    const p = (latex: string) => ce.parse(latex).evaluate().toString();
    expect(p('[10,20,30][[\\operatorname{NaN},1]]')).toBe('[NaN,10]');
    expect(p('[10,20,30][[\\infty,1]]')).toBe('[NaN,10]');
    expect(p('[10,20,30][[-\\infty,1]]')).toBe('[NaN,10]');
    expect(p('[(1,2),(3,4)][[\\operatorname{NaN},1]]')).toBe(
      '["Missing",(1, 2)]'
    );
  });
});

describe('a comprehension over an irrational offset finishes', () => {
  test('eight elements of marker in milliseconds, not an inert tree', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 10, 20, 30, 40, 50, 60, 70, 80]));
    // `√8` is irrational: every read is provably off the integers.
    const c = ce.box([
      'Comprehension',
      ['At', 'L', ['Add', 'i', ['Sqrt', ['Length', 'L']]]],
      ['Element', 'i', ['Range', 1, 8]],
    ]);
    const t = performance.now();
    expect(c.evaluate().toString()).toBe(
      '[NaN,NaN,NaN,NaN,NaN,NaN,NaN,NaN]'
    );
    // The time depends on the load of the machine, so the limit is asserted
    // only in a `CE_PERF=1` run. The value check above does not depend on time.
    if (process.env.CE_PERF === '1')
      expect(performance.now() - t).toBeLessThan(2000);
  });
});
