import { compile, ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const points: MathJsonExpression = [
  'List',
  ['Tuple', 1, 1],
  ['Tuple', 2, 4],
  ['Tuple', 3, 9],
  ['Tuple', 4, 16],
  ['Tuple', 5, 25],
];

const domain: MathJsonExpression = ['Element', 'k', ['List', 1, 2]];

const polygon = (geom: number[]) => ({ __tag: 'Polygon', geom });

describe('compiled Polygon results', () => {
  test('a polygon with separate point arguments', () => {
    const ce = new ComputeEngine();
    const result = compile(
      ce.parse('\\operatorname{polygon}((1,2),(3,4),(5,6))'),
      { fallback: false }
    );
    expect(result.run!()).toEqual(polygon([1, 2, 3, 4, 5, 6]));
    expect(result.shippable).toBe(false);
    expect(() => result.broadcast!({})).toThrow(/record/);
  });

  test('a list keeps empty polygons and undefined vertex slots', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'List',
      ['Polygon', ['List']],
      ['Polygon', ['List', ['Tuple', 1, 2], 'Missing', ['Tuple', 3, 'Missing']]],
    ]);
    const result = compile(expr, { fallback: false, optimize: false });
    expect(result.run!()).toEqual([
      polygon([]),
      polygon([1, 2, NaN, NaN, 3, NaN]),
    ]);
  });

  test('a comprehension with fixed vertex counts and live coordinates', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const expr = ce.expr([
      'Comprehension',
      ['Polygon', ['Tuple', 'k', 0], ['Tuple', 'k', 'n'], ['Tuple', 0, 'n']],
      domain,
    ]);
    const result = compile(expr, {
      fallback: false,
      symbolic: ['n'],
      optimize: false,
    });
    for (const n of [2, 3])
      expect(result.run!({ n })).toEqual([
        polygon([1, 0, 1, n, 0, n]),
        polygon([2, 0, 2, n, 0, n]),
      ]);
  });

  test.each([false, true])(
    'vertex counts vary by member and input (optimize: %s)',
    (optimize) => {
      const ce = new ComputeEngine();
      ce.declare('n', 'integer');
      const expr = ce.expr([
        'Comprehension',
        ['Polygon', ['Take', points, ['Add', 'k', 'n']]],
        domain,
      ]);
      const result = compile(expr, {
        fallback: false,
        symbolic: ['n'],
        optimize,
      });
      const geom = [1, 1, 2, 4, 3, 9, 4, 16, 5, 25];
      for (const n of [-1, 2, 3])
        expect(result.run!({ n })).toEqual([
          polygon(geom.slice(0, 2 * (n + 1))),
          polygon(geom.slice(0, 2 * (n + 2))),
        ]);
    }
  );

  test('an out-of-range vertex keeps its location in the polygon', () => {
    const ce = new ComputeEngine();
    ce.declare('i', 'integer');
    const expr = ce.expr([
      'Polygon',
      ['Tuple', 0, 0],
      ['At', points, 'i'],
      ['Tuple', 5, 6],
    ]);
    const result = compile(expr, { fallback: false, symbolic: ['i'] });
    expect(result.run!({ i: 2 })).toEqual(polygon([0, 0, 2, 4, 5, 6]));
    expect(result.run!({ i: 6 })).toEqual(polygon([0, 0, NaN, NaN, 5, 6]));
  });

  test('a comprehension with two domains keeps source order', () => {
    const ce = new ComputeEngine();
    const expr = ce.expr([
      'Comprehension',
      ['Polygon', ['Tuple', 'k', 'j']],
      domain,
      ['Element', 'j', ['List', 3, 4]],
    ]);
    expect(compile(expr, { fallback: false }).run!()).toEqual([
      polygon([1, 3]),
      polygon([1, 4]),
      polygon([2, 3]),
      polygon([2, 4]),
    ]);
  });

  test('an Epsil callback returns a runtime-sized polygon from a block', () => {
    const ce = new ComputeEngine();
    const expr = executeEpsil(
      ce,
      `(n: integer) => do {
        let count = n + 1
        polygon(take([(1, 1), (2, 4), (3, 9)], count))
      }`
    );
    expect(expr.diagnostics).toEqual([]);
    const result = compile(expr.value!, { fallback: false, optimize: false });
    expect(result.run!(1)).toEqual(polygon([1, 1, 2, 4]));
    expect(result.run!(2)).toEqual(polygon([1, 1, 2, 4, 3, 9]));
  });

  test.each(['glsl', 'interval-js'] as const)('declines on %s', (to) => {
    const ce = new ComputeEngine();
    const expr = ce.expr(['Polygon', ['Tuple', 1, 2]]);
    expect(() => compile(expr, { to, fallback: false })).toThrow(/Polygon/);
  });

  test.each<{ json: MathJsonExpression }>([
    { json: ['Polygon', ['Tuple', 1, 2, 3]] },
    { json: ['Polygon', ['Tuple', 1, 2], points] },
    { json: ['List', ['Polygon', ['Tuple', 1, 2]], 42] },
  ])('declines unsupported geometry %j', ({ json }) => {
    expect(() =>
      compile(new ComputeEngine().expr(json), { fallback: false })
    ).toThrow(/Polygon/);
  });
});
