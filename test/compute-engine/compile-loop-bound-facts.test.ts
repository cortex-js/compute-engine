import { ComputeEngine, compile } from '../../src/compute-engine';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const name of ['N', 'M']) ce.declare(name, 'integer');
  return ce;
}

// In the `complex` mode, the bounds of a loop can prove the sign of its
// index, so a radical or a logarithm of the index keeps the real lowering.
describe('real arithmetic from loop bounds', () => {
  test.each(['complex'] as const)(
    '%s uses a non-negative index',
    (mode) => {
      for (const body of ['\\ln(i)', '\\sqrt{9.91/i}']) {
        const ce = engine();
        const expr = ce.parse(`1+\\sum_{i=1}^{N}${body}`);
        const r = compile(expr, { mode });
        expect(r.success).toBe(true);
        for (const N of [0, 1, 3, 12]) {
          const expected = expr.subs({ N }).N().re;
          expect(r.run!({ N })).toBeCloseTo(expected, 12);
          expect(typeof r.run!({ N })).toBe('number');
        }
      }
    }
  );

  test('large constant bounds and Product use the same decision', () => {
    const ce = engine();
    ce.declare('x', 'real');
    const limited = compile(ce.parse('x+\\sum_{i=1}^{4}x\\ln(i)'), {
      iterationBudget: 2,
      mode: 'complex',
    });
    // Over the budget, the sum is NaN (the complex NaN of the complex mode).
    const over = limited.run!({ x: 2 }) as number | { re: number };
    expect(typeof over === 'number' ? over : over.re).toBeNaN();
    const expr = ce.parse('\\prod_{i=1}^{N}\\sqrt{1/i}');
    const product = compile(expr, { mode: 'complex' });
    expect(product.run!({ N: 4 })).toBeCloseTo(1 / Math.sqrt(24), 12);
    expect(product.run!({ N: 0 })).toBe(1);
  });

  test('negative and unknown lower bounds retain complex arithmetic', () => {
    for (const lower of ['-2', 'M']) {
      const ce = engine();
      const expr = ce.parse(`\\sum_{i=${lower}}^{N}\\sqrt{i}`);
      const r = compile(expr, { mode: 'complex' });
      const expected = expr.subs({ N: -1, M: -2 }).N();
      const actual = r.run!({ N: -1, M: -2 }) as { re: number; im: number };
      expect(actual.re).toBeCloseTo(expected.re, 12);
      expect(actual.im).toBeCloseTo(expected.im, 12);
    }
  });

  test('a nested binder with the same name hides the outer bound', () => {
    const ce = engine();
    const expr = ce.parse(
      '\\sum_{i=1}^{N}(\\ln(i)+\\left|\\sum_{i=-2}^{M}\\sqrt{i}\\right|)'
    );
    const r = compile(expr, { mode: 'complex' });
    expect(r.success).toBe(true);
    expect(r.run!({ N: 3, M: -1 })).toBeCloseTo(
      Math.log(6) + 3 * (Math.sqrt(2) + 1),
      12
    );
  });

  test('a helper parameter does not inherit a same-named loop bound', () => {
    const ce = engine();
    ce.parse('g(i):=\\ln(i)').evaluate();
    const expr = ce.parse('\\sum_{i=1}^{N}(\\ln(i)+\\left|g(-i)\\right|)');
    const r = compile(expr, { mode: 'complex' });
    expect(r.success).toBe(true);
    expect(r.run!({ N: 3 })).toBeCloseTo(expr.subs({ N: 3 }).N().re, 12);
  });

  test('non-finite bounds and iteration budgets retain their guards', () => {
    const ce = engine();
    const expr = ce.parse('\\sum_{i=1}^{N}\\ln(i)');
    const r = compile(expr, { iterationBudget: 5, mode: 'complex' });
    expect(r.run!({ N: 5 })).toBeCloseTo(Math.log(120), 12);
    // Over the budget, the sum is NaN (here the complex NaN of the
    // complex mode).
    const over = r.run!({ N: 6 }) as number | { re: number; im: number };
    expect(typeof over === 'number' ? over : over.re).toBeNaN();
  });
});
