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
 * expression with unknowns, an infinity, an exact constant within rounding
 * of an integer — is left alone, as before.
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
    expect(ev('L[\\infty]')).toMatch(/^At\(/);
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
    expect(performance.now() - t).toBeLessThan(2000);
  });
});
