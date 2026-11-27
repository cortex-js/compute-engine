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
  test('sibling reductions share one scan and one mapped value per element', () => {
    const ce = engine();
    const mapped: MathJsonExpression = [
      'Map',
      ['Function', ['Sin', 't'], 't'],
      'P',
    ];
    const r = compile(ce.box(['Tuple', ['Sum', mapped], ['Max', mapped]]), {
      fallback: false,
    });
    expect(r.code).not.toContain('new Array');
    expect(r.code?.match(/Math\.sin\(/g)).toHaveLength(1);
    expect(r.run!({ P: [] })).toEqual([0, NaN]);
    const P = [1, 2, 3];
    const values = P.map(Math.sin);
    expect(r.run!({ P })).toEqual([
      values.reduce((a, b) => a + b, 0),
      Math.max(...values),
    ]);
  });

  test('a reversed map streams in reverse fold order', () => {
    const ce = engine();
    const mapped: MathJsonExpression = [
      'Map',
      ['Function', ['Abs', 't'], 't'],
      'P',
    ];
    const r = compile(ce.box(['Sum', ['Reverse', mapped]]), {
      fallback: false,
    });
    expect(r.code).not.toContain('new Array');
    const P = [1e16, 1, -1];
    expect(r.run!({ P })).toBe(1e16 + 2);
    expect(r.run!({ P: [] })).toBe(0);
  });

  test('a list sum reuses its private accumulator across terms', () => {
    const ce = engine();
    ce.declare('A', 'list<real^24>');
    ce.declare('n', 'integer');
    const r = compile(
      ce.box(['Sum', ['Add', 'A', 'k'], ['Limits', 'k', 1, 'n']]),
      { fallback: false }
    );
    expect(r.code?.match(/new Array/g)).toHaveLength(1);
    expect(r.code).not.toContain('return _r');
    const A = Array.from({ length: 24 }, (_, i) => i / 4);
    const first = r.run!({ A, n: 4 });
    expect(first).toEqual(A.map((x) => 4 * x + 10));
    expect(r.run!({ A, n: 0 })).toEqual(Array(24).fill(0));
    expect(r.run!({ A, n: 2 })).toEqual(A.map((x) => 2 * x + 3));
    expect(first).toEqual(A.map((x) => 4 * x + 10));
    expect(A).toEqual(Array.from({ length: 24 }, (_, i) => i / 4));
  });

  test('the interval list sum keeps the interval runtime', () => {
    const ce = engine();
    ce.declare('A', 'list<real^24>');
    ce.declare('n', 'integer');
    const r = compile(
      ce.box(['Sum', ['Add', 'A', 'k'], ['Limits', 'k', 1, 'n']]),
      { to: 'interval-js', fallback: false }
    );
    expect(r.code).not.toContain('_SYS.tick');
    expect(r.run!({ A: Array(24).fill(2), n: 2 })).toEqual(
      Array.from({ length: 24 }, () => ({
        kind: 'interval',
        value: { lo: 7, hi: 7 },
      }))
    );
  });

  test('nested list sums start with fresh accumulators', () => {
    const ce = engine();
    ce.declare('A', 'list<real^24>');
    ce.declare('n', 'integer');
    const sum: MathJsonExpression = [
      'Sum',
      ['Add', 'A', ['Multiply', 'j', 'k']],
      ['Limits', 'j', 1, 'n'],
    ];
    const input = { A: Array(24).fill(0), n: 1 };
    const nested = compile(
      ce.box(['Sum', ['Max', sum], ['Limits', 'k', 1, 100]]),
      { fallback: false }
    );
    expect(nested.run!(input)).toBe(5050);
    const mapped = compile(
      ce.box(['Map', ['Function', sum, 'k'], ['Range', 1, 24]]),
      { fallback: false }
    );
    expect(mapped.run!(input)).toEqual(
      Array.from({ length: 24 }, (_, k) => Array(24).fill(k + 1))
    );
  });

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
