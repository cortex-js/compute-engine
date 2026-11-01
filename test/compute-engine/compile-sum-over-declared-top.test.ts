import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

// A symbol declared `any` or `value` can hold a list, and the interpreter
// folds `Sum(x)` and `Product(x)` over it: `Sum(x)` with `x = [1, 2, 3]` is 6.
// For a scalar value it gives the value itself (`Sum(5)` is 5). Compiled code
// does not test the shape of a value at run time, so the JavaScript target
// declines `Sum` and `Product` over such a symbol, and the interpreter
// fallback computes the value.

const js = (ce: ComputeEngine, json: unknown, options: object = {}) =>
  compile(ce.box(json as never), { to: 'javascript', ...options } as never)!;

// The compiled function of `json` with the input `x` of type `type`, called
// with the value of `x`. An INPUT declared `any` is refused at compile time
// (ROADMAP CE-712.1), so for `any` the expression is compiled as the body of
// a function literal whose parameter `x` is declared `any`. `unsupported`
// names `x`.
function compiled(
  type: string,
  json: unknown
): {
  success: boolean;
  unsupported: string[] | undefined;
  run: (input: unknown) => unknown;
} {
  const ce = new ComputeEngine();
  if (type === 'any') {
    const result = compile(
      ce.box(['Function', json, ['Typed', 'x', "'any'"]] as never),
      { to: 'javascript' } as never
    )!;
    const run = result.run as unknown as (input: unknown) => unknown;
    return {
      success: result.success,
      unsupported: result.unsupported,
      run: (input) => run(input),
    };
  }
  ce.declare('x', type as never);
  const result = js(ce, json);
  return {
    success: result.success,
    unsupported: result.unsupported,
    run: (input) => result.run!({ x: input }),
  };
}

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
      test(`${JSON.stringify(shape)} with \`x: ${type}\` declines, and the fallback gives the interpreter's values`, () => {
        const result = compiled(type, shape);
        expect(result.success).toBe(false);
        expect(result.unsupported).toContain('x');
        for (const row of ROWS) {
          const [value, input] = row;
          const expected = row[2 + k];
          // The table holds the interpreter's values.
          expect(interpreted(type, shape, value)).toBe(asString(expected));
          expect(result.run(input)).toEqual(expected);
        }
      });
    });
  }

  test('an INPUT declared `any` is refused at compile time', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'any');
    const result = js(ce, ['Sum', 'x']);
    expect(result.success).toBe(false);
    expect(result.diagnostic?.code).toBe('untyped-input');
    expect(result.unsupported).toContain('x');
  });

  test('a symbol declared `expression` still declines', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'expression');
    const result = js(ce, ['Sum', 'x']);
    expect(result.success).toBe(false);
    expect(result.run!({ x: [1, 2, 3] })).toBe(6);
  });

  test('a function literal with a parameter declared `any` declines', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Sum', 't'],
      ['Typed', 't', "'any'"],
    ] as never);
    expect(() =>
      compile(f, { to: 'javascript', fallback: false } as never)
    ).toThrow(/`Sum` over "t": it is declared `any` or `value`/);
    const result = compile(f, { to: 'javascript' } as never)!;
    expect(result.success).toBe(false);
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
