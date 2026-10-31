import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A symbol declared `any` or `value` can hold a list, and the interpreter
// folds `Sum(x)` and `Product(x)` over it: `Sum(x)` with `x = [1, 2, 3]` is 6.
// For a scalar value it gives the value itself (`Sum(5)` is 5). The
// JavaScript target compiles the collection form of `Sum` and `Product` over
// such a symbol to a fold that tests the value at run time. It declined
// before ("no indexing set").

const js = (ce: ComputeEngine, json: unknown, options: object = {}) =>
  compile(ce.box(json as never), { to: 'javascript', ...options } as never)!;

// The interpreter's value of `json` with `x` assigned `value`, as a string.
function interpreted(type: string, json: unknown, value: unknown): string {
  const ce = new ComputeEngine();
  ce.declare('x', type as never);
  const e = ce.box(json as never);
  ce.assign('x', ce.box(value as never));
  return e.evaluate().toString();
}

// Each row: the MathJSON value of `x`, the same value as a run-time input,
// and the interpreter's value of `Sum(x)`, `Product(x)`, `Sum(x) + 1` and
// `2 Sum(x)`, as plain JavaScript values.
const ROWS: Array<[unknown, unknown, unknown, unknown, unknown, unknown]> = [
  [5, 5, 5, 5, 6, 10],
  [-2.5, -2.5, -2.5, -2.5, -1.5, -5],
  [['List', 1, 2, 3], [1, 2, 3], 6, 6, 7, 12],
  [['List'], [], 0, 1, 1, 0],
  [
    ['List', ['List', 1, 2], ['List', 3, 4]],
    [
      [1, 2],
      [3, 4],
    ],
    [4, 6],
    [3, 8],
    [5, 7],
    [8, 12],
  ],
];

const SHAPES = [
  ['Sum', 'x'],
  ['Product', 'x'],
  ['Add', ['Sum', 'x'], 1],
  ['Multiply', 2, ['Sum', 'x']],
];

const asString = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(asString).join(',')}]` : String(v);

describe('COMPILED SUM AND PRODUCT OVER A SYMBOL DECLARED `any` OR `value`', () => {
  for (const type of ['any', 'value']) {
    SHAPES.forEach((shape, k) => {
      test(`${JSON.stringify(shape)} with \`x: ${type}\` compiles to the interpreter's values`, () => {
        const ce = new ComputeEngine();
        ce.declare('x', type as never);
        const result = js(ce, shape);
        expect(result.success).toBe(true);
        for (const row of ROWS) {
          const [value, input] = row;
          const expected = row[2 + k];
          // The table holds the interpreter's values.
          expect(interpreted(type, shape, value)).toBe(asString(expected));
          expect(result.run!({ x: input })).toEqual(expected);
        }
      });
    });

    test(`a numeric typed array for \`x: ${type}\` is summed as a list`, () => {
      const ce = new ComputeEngine();
      ce.declare('x', type as never);
      expect(js(ce, ['Sum', 'x']).run!({ x: new Float64Array([1, 2, 3]) })).toBe(
        6
      );
      expect(
        js(ce, ['Product', 'x']).run!({ x: new Float64Array([2, 3, 4]) })
      ).toBe(24);
    });
  }

  test('a symbol declared `expression` still declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'expression');
    const result = js(ce, ['Sum', 'x']);
    expect(result.success).toBe(false);
    expect(result.run!({ x: [1, 2, 3] })).toBe(6);
  });

  test('a function literal with a parameter declared `any` compiles', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Sum', 't'],
      ['Typed', 't', "'any'"],
    ] as never);
    const result = compile(f, { to: 'javascript' } as never)!;
    expect(result.success).toBe(true);
    const at = (arg: unknown) =>
      ce
        .box(['Apply', f.json, arg] as never)
        .evaluate()
        .toString();
    expect(at(['List', 1, 2, 3])).toBe('6');
    expect(result.run!([1, 2, 3])).toBe(6);
    expect(at(5)).toBe('5');
    expect(result.run!(5)).toBe(5);
    expect(at(['List', ['List', 1, 2], ['List', 3, 4]])).toBe('[4,6]');
    expect(
      result.run!([
        [1, 2],
        [3, 4],
      ])
    ).toEqual([4, 6]);
  });
});
