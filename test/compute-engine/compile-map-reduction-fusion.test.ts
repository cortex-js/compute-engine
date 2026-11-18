import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

const squareMap: MathJsonExpression = [
  'Map',
  ['Function', ['Square', 't'], 't'],
  'P',
];
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('P', 'list<real>');
  return ce;
}
const source = (r: { code?: string; preamble?: string }): string =>
  (r.preamble ?? '') + (r.code ?? '');

describe('mapped scalar reductions', () => {
  test.each(['Sum', 'Product'])(
    '%s of a map gives the fold of the mapped values',
    (head) => {
      const ce = engine();
      const expr = ce.box([head, squareMap]);
      const r = compile(expr);
      expect(r.success).toBe(true);
      for (const P of [[], [1], [-2, 3, 0.5], [1e-100, 1e100]]) {
        const expected = P.map((t) => t * t).reduce(
          (a, b) => (head === 'Sum' ? a + b : a * b),
          head === 'Sum' ? 0 : 1
        );
        expect(r.run!({ P })).toBe(expected);
      }
      expect(r.run!({ P: [1, 2, 3] })).toBe(
        expr.subs({ P: ['List', 1, 2, 3] }).N().re
      );
    }
  );

  test('fold order, signed zero and non-finite terms remain unchanged', () => {
    const ce = engine();
    const map: MathJsonExpression = ['Map', ['Function', 't', 't'], 'P'];
    for (const head of ['Sum', 'Product']) {
      const r = compile(ce.box([head, map]));
      for (const P of [[1e16, -1e16, 1], [-0], [Infinity, 0], [NaN, 3]]) {
        const expected = P.map((t) => t).reduce(
          (a, b) => (head === 'Sum' ? a + b : a * b),
          head === 'Sum' ? 0 : 1
        );
        expect(r.run!({ P })).toBe(expected);
      }
    }
  });

  test('complex-producing callbacks retain the complex combiner', () => {
    const ce = engine();
    const expr = ce.box(['Add', 1, ['Sum', ['Map', 'Ln', 'P']]]);
    const r = compile(expr, { mode: 'complex' });
    expect(r.success).toBe(true);
    expect(source(r)).not.toContain('.map(');
    const actual = r.run!({ P: [-1, 1] }) as { re: number; im: number };
    expect(actual.re).toBeCloseTo(1, 12);
    expect(actual.im).toBeCloseTo(Math.PI, 12);
  });

});
