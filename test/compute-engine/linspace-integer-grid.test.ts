import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A `Linspace` whose step is an integer computes its samples as
// `lower + k·step` (`linspaceSample`, `library/collections.ts`): the usual
// form `lower + span·k/denom` rounds the product past 2⁵³ for a long grid.
// The extremum test for an inexact sample (`linspaceHasInexactSample`,
// `library/arithmetic.ts`) then needs no walk: `Max(Indeterminate,
// Linspace(0, 10⁹ − 1, 10⁹))` read a billion samples (1.3 s) to answer.
describe('a Linspace on an integer grid', () => {
  const ce = new ComputeEngine();
  const grid = ['Linspace', 0, 999999999, 1000000000];

  test('the samples past 2^53 / span are exact integers', () => {
    expect(ce.box(['At', grid, 999999999]).evaluate().json).toBe(999999998);
    expect(ce.box(['At', grid, 1000000000]).evaluate().json).toBe(999999999);
    expect(ce.box(['At', ['Linspace', -3, 3, 7], 3]).evaluate().json).toBe(-1);
  });

  test('a span past the safe integers keeps the usual form', () => {
    expect(ce.box(['At', ['Linspace', 0, 1e20, 8], 4]).evaluate().json).toBe(
      42857142857142850000
    );
  });

  test('the compiled JavaScript samples the integer grid the same way', () => {
    const grid7 = ['Linspace', 0, 9007199254740990, 7];
    const compiled = compile(ce.box(grid7))?.run?.() as number[];
    expect(compiled[3]).toBe(4503599627370495);
    expect(ce.box(['At', grid7, 4]).evaluate().json).toBe(4503599627370495);
    const float = compile(ce.box(['Linspace', 0, 1, 11]))?.run?.() as number[];
    expect(float[3]).toBe(0.3);
  });

  test('a float grid keeps its samples', () => {
    expect(ce.box(['At', ['Linspace', 0, 1, 11], 4]).evaluate().json).toBe(0.3);
    expect(ce.box(['At', ['Linspace', 1, 10, 4], 2]).evaluate().json).toBe(4);
  });

  test('an extremum with an Indeterminate operand does not walk the grid', () => {
    const start = Date.now();
    expect(ce.box(['Max', 'Indeterminate', grid]).evaluate().toString()).toBe(
      'Indeterminate'
    );
    expect(ce.box(['Min', 'Indeterminate', grid]).evaluate().toString()).toBe(
      'Indeterminate'
    );
    expect(Date.now() - start).toBeLessThan(500);
    // A grid with inexact samples still makes the result `NaN`.
    expect(
      ce
        .box(['Max', 'Indeterminate', ['Linspace', 0, 10, 1000000000]])
        .evaluate().isNaN
    ).toBe(true);
  });
});
