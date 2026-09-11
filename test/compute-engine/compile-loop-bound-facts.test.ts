import { ComputeEngine, compile } from '../../src/compute-engine';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const name of ['N', 'M']) ce.declare(name, 'integer');
  return ce;
}

const source = (r: { code?: string; preamble?: string }): string =>
  (r.preamble ?? '') + (r.code ?? '');

describe('real arithmetic from loop bounds', () => {
  test.each(['auto', 'complex'] as const)(
    '%s uses a non-negative index',
    (mode) => {
      for (const body of ['\\ln(i)', '\\sqrt{9.91/i}']) {
        const ce = engine();
        const expr = ce.parse(`1+\\sum_{i=1}^{N}${body}`);
        const r = compile(expr, { mode });
        expect(r.success).toBe(true);
        expect(source(r)).not.toMatch(/_SYS\.c(?:ln|sqrt)/);
        expect(source(r)).not.toContain('im:');
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
    const sum = compile(ce.parse('\\sum_{i=1}^{101}\\ln(i)'), {
      constantFold: false,
    });
    expect(sum.success).toBe(true);
    // Disabling constant folding also disables the contextual analysis hook.
    expect(source(sum)).toContain('_SYS.cln');
    ce.declare('x', 'real');
    const large = compile(ce.parse('x+\\sum_{i=1}^{101}x\\ln(i)'));
    expect(source(large)).not.toContain('_SYS.cln');
    const limited = compile(ce.parse('x+\\sum_{i=1}^{4}x\\ln(i)'), {
      iterationBudget: 2,
    });
    expect(limited.run!({ x: 2 })).toBeNaN();
    const expr = ce.parse('\\prod_{i=1}^{N}\\sqrt{1/i}');
    const product = compile(expr);
    expect(source(product)).not.toContain('_SYS.csqrt');
    expect(product.run!({ N: 4 })).toBeCloseTo(1 / Math.sqrt(24), 12);
    expect(product.run!({ N: 0 })).toBe(1);
  });

  test('negative and unknown lower bounds retain complex arithmetic', () => {
    for (const lower of ['-2', 'M']) {
      const ce = engine();
      const expr = ce.parse(`\\sum_{i=${lower}}^{N}\\sqrt{i}`);
      const r = compile(expr);
      expect(source(r)).toContain('_SYS.csqrt');
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
    const r = compile(expr);
    expect(r.success).toBe(true);
    expect(source(r)).toContain('_SYS.csqrt');
    expect(source(r)).not.toContain('_SYS.cln');
    expect(r.run!({ N: 3, M: -1 })).toBeCloseTo(
      Math.log(6) + 3 * (Math.sqrt(2) + 1),
      12
    );
  });

  test('a helper parameter does not inherit a same-named loop bound', () => {
    const ce = engine();
    ce.parse('g(i):=\\ln(i)').evaluate();
    const expr = ce.parse('\\sum_{i=1}^{N}(\\ln(i)+\\left|g(-i)\\right|)');
    const r = compile(expr);
    expect(r.success).toBe(true);
    expect(source(r)).toContain('_SYS.cln');
    expect(r.run!({ N: 3 })).toBeCloseTo(expr.subs({ N: 3 }).N().re, 12);
  });

  test('non-finite bounds and iteration budgets retain their guards', () => {
    const ce = engine();
    const expr = ce.parse('\\sum_{i=1}^{N}\\ln(i)');
    const r = compile(expr, { iterationBudget: 5 });
    expect(r.run!({ N: 5 })).toBeCloseTo(Math.log(120), 12);
    for (const N of [6, NaN, Infinity]) expect(r.run!({ N })).toBeNaN();
    expect(r.run!({ N: -Infinity })).toBe(0);
    const unrestricted = compile(expr);
    for (const N of [NaN, Infinity, -Infinity])
      expect(unrestricted.run!({ N })).toBeNaN();
    const unrelated = compile(ce.parse('\\ln(M)'));
    expect(source(unrelated)).toContain('_SYS.cln');
  });
});
