import { ComputeEngine } from '../../src/compute-engine';

/**
 * Mathematica-style surface forms (Tier 1):
 *  - iterator-triple `Set`s `{i, lo, hi}` / `{i, lo, hi, step}` in the
 *    iterator slot of `Sum`, `Product`, `Integrate`, and higher-order `D`;
 *  - the `\mathrm{D}(f, x, …)` function-call derivative;
 *  - the rule-arrow `Limit(f, x -> x0)` form.
 *
 * A fresh engine avoids cross-test contamination of the shared instance.
 */
const ce = new ComputeEngine();

function evalStr(latex: string): string {
  return ce.parse(latex).evaluate().toString();
}

describe('Iterator-triple Sets in the iterator slot', () => {
  test('Sum with a `{i, lo, hi}` triple matches the Element form', () => {
    expect(evalStr('\\mathrm{Sum}(i^2, \\{i, 1, 10\\})')).toBe('385');
    // Same canonical form and result as the Element/Range spec.
    expect(
      ce.box(['Sum', ['Square', 'i'], ['Set', 'i', 1, 10]]).evaluate().json
    ).toEqual(
      ce
        .box(['Sum', ['Square', 'i'], ['Element', 'i', ['Range', 1, 10]]])
        .evaluate().json
    );
  });

  test('Product with a `{i, lo, hi}` triple', () => {
    expect(evalStr('\\mathrm{Product}(i, \\{i, 1, 5\\})')).toBe('120');
  });

  test('Sum with a step: `{i, 0, 10, 2}`', () => {
    expect(evalStr('\\mathrm{Sum}(i, \\{i, 0, 10, 2\\})')).toBe('30');
    expect(
      ce.box(['Sum', 'i', ['Set', 'i', 0, 10, 2]]).evaluate().toString()
    ).toBe('30');
  });

  test('Sum with symbolic bounds `{k, 1, n}` keeps the bounds', () => {
    // Matches the native `\sum_{k=1}^n k` form (symbolic, closed-form-capable).
    expect(evalStr('\\mathrm{Sum}(k, \\{k, 1, n\\})')).toBe(
      evalStr('\\sum_{k=1}^{n} k')
    );
  });

  test('Integrate with a `{x, lo, hi}` triple is a definite integral', () => {
    expect(evalStr('\\mathrm{Integrate}(x^2, \\{x, 0, 1\\})')).toBe('1/3');
    expect(evalStr('\\int_0^1 x^2 dx')).toBe('1/3');
  });

  test('malformed Set in the iterator slot keeps today’s behavior', () => {
    // First element not a symbol → not a triple → stays an error, not a guess.
    const j = ce.parse('\\mathrm{Sum}(i^2, \\{1, 2, 3\\})').json as unknown[];
    expect(j[0]).toBe('Sum');
    expect(JSON.stringify(j)).toContain('Error');
  });

  test('a `Set` outside an iterator slot is still a plain Set', () => {
    expect(ce.parse('\\{1, 2, 3\\}').json).toEqual(['Set', 1, 2, 3]);
    expect(ce.box(['Set', 1, 2, 3]).json).toEqual(['Set', 1, 2, 3]);
  });
});

describe('\\mathrm{D} function-call derivative', () => {
  test('D(f, x) is the derivative operator', () => {
    expect(evalStr('\\mathrm{D}(x^3, x)')).toBe('3x^2');
  });

  test('D(f, x, y) is a sequential partial derivative', () => {
    expect(
      ce.parse('\\mathrm{D}(x^2 y^2, x, y)').evaluate().isSame(ce.parse('4xy'))
    ).toBe(true);
  });

  test('D(f, {x, n}) is the n-th derivative', () => {
    expect(evalStr('\\mathrm{D}(x^3, \\{x, 2\\})')).toBe('6x');
    expect(evalStr('\\mathrm{D}(x^4, \\{x, 3\\})')).toBe('24x');
  });

  test('a bare \\mathrm{D} stays the D_upright glyph', () => {
    expect(ce.parse('\\mathrm{D}', { canonical: false }).json).toBe(
      'D_upright'
    );
  });
});

describe('Limit with a rule-arrow argument', () => {
  test('Limit(f, x -> x0) evaluates the two-sided limit', () => {
    expect(evalStr('\\mathrm{Limit}(\\frac{\\sin x}{x}, x\\to 0)')).toBe('1');
    // Matches the native `\lim` form.
    expect(evalStr('\\lim_{x\\to 0}\\frac{\\sin x}{x}')).toBe('1');
  });
});
