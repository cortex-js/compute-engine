import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const nlimit = (latex: string) => ce.parse(latex).N().re;

// CE-184: a numeric limit whose Richardson estimate is smaller than its own
// error estimate is rounding noise around 0, and is returned as 0.
describe('CE-184 NLimit snaps a residue below its error estimate to 0', () => {
  test('7t/(t^2+9) at infinity', () => {
    expect(nlimit('\\operatorname{NLimit}(t \\mapsto \\frac{7t}{t^2+9}, \\infty)')).toBe(0);
  });

  test('|Gamma(it)| at infinity', () => {
    expect(nlimit('\\operatorname{NLimit}(t \\mapsto |\\Gamma(it)|, \\infty)')).toBe(0);
  });

  test('a small limit computed from small samples is kept', () => {
    expect(
      nlimit('\\operatorname{NLimit}(t \\mapsto 10^{-20}(1+\\frac{1}{t}), \\infty)')
    ).toBeCloseTo(1e-20, 30);
    expect(
      nlimit('\\operatorname{NLimit}(t \\mapsto 10^{-20}(1+\\frac{1}{t}), \\infty)')
    ).not.toBe(0);
  });

  // The first extrapolation step gives 1e-20 with an error of 2e-20, below
  // the default absolute tolerance, so the extrapolation stops there; the
  // estimate is right, and a refined extrapolation confirms it.
  test('a small limit whose first error estimate exceeds it is kept', () => {
    const value = nlimit(
      '\\operatorname{NLimit}(t \\mapsto 10^{-20}(1+\\frac{2}{t}), \\infty)'
    );
    expect(value).not.toBe(0);
    expect(Math.abs(value / 1e-20 - 1)).toBeLessThan(1e-6);
  });

  test('a nonzero limit is unchanged', () => {
    expect(nlimit('\\operatorname{NLimit}(t \\mapsto \\frac{\\sin t}{t}, 0)')).toBeCloseTo(1, 12);
  });
});
