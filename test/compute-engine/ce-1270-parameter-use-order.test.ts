/**
 * CE-1270: the value of a function literal does not depend on the order of
 * the uses of its untyped parameters.
 *
 * A node of the body is built with the type that a parameter has when the
 * node is boxed. When a later use changes the type of a bare parameter from
 * a number type to another type (`Determinant(A)` makes `A` a matrix), the
 * body is boxed once more from its raw form, with the parameter starting at
 * its final type (`canonicalFunctionLiteralArguments()`,
 * `function-utils.ts`). A use that requires a collection (`Length(x)`) after
 * uses that only map over a collection (`x + x`) makes the parameter a
 * collection.
 *
 * An untyped name in a product is a number: `(A, B) ↦ A·B − B·A` with no
 * other use stays `0` for matrix arguments (documented behaviour).
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

const A = ['List', ['List', 1, 2], ['List', 3, 4]];
const B = ['List', ['List', 0, 1], ['List', 1, 0]];
const COMM = ['Subtract', ['Multiply', 'A', 'B'], ['Multiply', 'B', 'A']];
const COMM_VALUE = [
  ['List', -1, -3],
  ['List', 3, 1],
];

/** The type of `f` and the value of `f(...args)`, with `f` assigned the
 * literal, and the value of the literal applied directly. */
function run(
  body: unknown,
  params: string[],
  args: unknown[]
): { type: string; assigned: unknown; applied: unknown } {
  const ce = new ComputeEngine();
  ce.assign('f', ce.box(['Function', body, ...params] as any));
  const assigned = ce.box(['f', ...args] as any).evaluate().json;
  const applied = ce
    .box(['Apply', ['Function', body, ...params], ...args] as any)
    .evaluate().json;
  return { type: ce.box('f').type.toString(), assigned, applied };
}

describe('CE-1270: a matrix use after a product of the parameters', () => {
  test('the commutator first, the determinants after', () => {
    const r = run(
      ['Tuple', COMM, ['Determinant', 'A'], ['Determinant', 'B']],
      ['A', 'B'],
      [A, B]
    );
    expect(r.type).toBe(
      '(A: matrix, B: matrix) -> tuple<matrix, number, number>'
    );
    expect(r.assigned).toEqual(['Tuple', ['List', ...COMM_VALUE], -2, -1]);
    expect(r.applied).toEqual(r.assigned);
  });

  test('the determinants first, the commutator after', () => {
    const r = run(
      ['Tuple', ['Determinant', 'A'], ['Determinant', 'B'], COMM],
      ['A', 'B'],
      [A, B]
    );
    expect(r.type).toBe(
      '(A: matrix, B: matrix) -> tuple<number, number, matrix>'
    );
    expect(r.assigned).toEqual(['Tuple', -2, -1, ['List', ...COMM_VALUE]]);
    expect(r.applied).toEqual(r.assigned);
  });

  test('the commutator alone: untyped names are numbers', () => {
    const r = run(COMM, ['A', 'B'], [A, B]);
    expect(r.type).toBe('(A: unknown, B: unknown) -> number');
    expect(r.assigned).toEqual(['List', ['List', 0, 0], ['List', 0, 0]]);
  });

  test('a curried literal: the inner literal is boxed again', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        [
          'Function',
          ['Tuple', COMM, ['Determinant', 'A'], ['Determinant', 'B']],
          'B',
        ],
        'A',
      ] as any)
    );
    expect(ce.box('f').type.toString()).toBe(
      '(A: matrix) -> (B: matrix) -> tuple<matrix, number, number>'
    );
    expect(ce.box([['f', A], B] as any).evaluate().json).toEqual([
      'Tuple',
      ['List', ...COMM_VALUE],
      -2,
      -1,
    ]);
  });
});

describe('CE-1270: a collection use after a mapping use', () => {
  test('x + x, then Length(x)', () => {
    const r = run(
      ['Tuple', ['Add', 'x', 'x'], ['Length', 'x']],
      ['x'],
      [['List', 1, 2, 3]]
    );
    expect(r.type).toBe(
      '(x: collection) -> tuple<any, integer | signed_infinity>'
    );
    expect(r.assigned).toEqual(['Tuple', ['List', 2, 4, 6], 3]);
    expect(r.applied).toEqual(r.assigned);
  });

  test('Length(x), then x + x', () => {
    const r = run(
      ['Tuple', ['Length', 'x'], ['Add', 'x', 'x']],
      ['x'],
      [['List', 1, 2, 3]]
    );
    expect(r.type).toBe(
      '(x: collection) -> tuple<integer | signed_infinity, any>'
    );
    expect(r.assigned).toEqual(['Tuple', 3, ['List', 2, 4, 6]]);
    expect(r.applied).toEqual(r.assigned);
  });

  test('Sin(x) + Length(x) binds the list whole', () => {
    const r = run(
      ['Add', ['Sin', 'x'], ['Length', 'x']],
      ['x'],
      [['List', 0, 0]]
    );
    expect(r.type).toBe('(x: collection) -> any');
    expect(r.assigned).toEqual(['List', 2, 2]);
  });

  test('Range(n), then Length(n): a use that does not map keeps n a number', () => {
    const r = run(['Tuple', ['Range', 'n'], ['Length', 'n']], ['n'], [3]);
    expect(r.type).toBe(
      '(n: unknown) -> tuple<list<integer>, integer | signed_infinity>'
    );
    expect(JSON.stringify(r.assigned)).toContain("'incompatible-type'");
  });
});

describe('CE-1270: the number of boxings of a body', () => {
  function counter(): { ce: ComputeEngine; count: () => number } {
    const ce = new ComputeEngine();
    let n = 0;
    ce.declare('Mark', {
      signature: '(any) -> any',
      canonical: (ops: ReadonlyArray<Expression>, { engine }: any) => {
        n += 1;
        return engine._fn('Mark', [...ops]);
      },
    } as any);
    return { ce, count: () => n };
  }

  test('a body whose uses keep each type is boxed once', () => {
    const { ce, count } = counter();
    ce.box([
      'Function',
      ['Tuple', ['Determinant', 'A'], ['Determinant', 'B'], ['Mark', COMM]],
      'A',
      'B',
    ] as any);
    expect(count()).toBe(1);
  });

  test('a body boxed again is boxed twice, never three times', () => {
    const { ce, count } = counter();
    const f = ce.box([
      'Function',
      ['Tuple', ['Mark', COMM], ['Determinant', 'A'], ['Determinant', 'B']],
      'A',
      'B',
    ] as any);
    expect(count()).toBe(2);
    expect(f.type.toString()).toBe(
      '(A: matrix, B: matrix) -> tuple<any, number, number>'
    );
  });

  // Each level is a literal whose parameter is used in a product, then as a
  // matrix; the innermost body holds the counter.
  function nested(depth: number): number {
    const { ce, count } = counter();
    const names = ['A', 'B', 'C', 'D'];
    let lit: unknown = undefined;
    for (let i = depth - 1; i >= 0; i--) {
      const p = names[i];
      const parts: unknown[] = [
        ['Subtract', ['Multiply', p, 'K'], ['Multiply', 'K', p]],
        ['Determinant', p],
      ];
      if (i === depth - 1) parts.unshift(['Mark', 0]);
      if (lit !== undefined) parts.push(lit);
      lit = ['Function', ['Tuple', ...parts], p];
    }
    ce.box(lit as any);
    return count();
  }

  test('nested literals: one more boxing of the innermost body per level', () => {
    expect([1, 2, 3, 4].map(nested)).toEqual([2, 3, 4, 5]);
  });
});

/** `x ↦ (x + x, USE)` and `x ↦ (USE, x + x)`, boxed and applied to
 * `[3, 1, 2]`: the parameter type and the two values do not depend on the
 * order. */
describe('CE-1270: a collection use after x + x, in both orders', () => {
  const L = ['List', 3, 1, 2];
  const f = (body: unknown) => ['Function', body, 'x'];
  function both(use: unknown): {
    types: [string, string];
    values: [unknown, unknown];
  } {
    const result = (body: unknown): [string, unknown] => {
      const ce = new ComputeEngine();
      const t = ce
        .box(f(body) as any)
        .type.toString()
        .split(' -> ')[0];
      const v = ce.box(['Apply', f(body), L] as any).evaluate().json;
      return [t, v];
    };
    const [t1, v1] = result(['Tuple', ['Add', 'x', 'x'], use]);
    const [t2, v2] = result(['Tuple', use, ['Add', 'x', 'x']]);
    return { types: [t1, t2], values: [v1, v2] };
  }
  test.each([
    ['Length', ['Length', 'x'], '(x: collection)'],
    ['Sort', ['Sort', 'x'], '(x: indexed_collection<any>)'],
    ['Reverse', ['Reverse', 'x'], '(x: indexed_collection<any>)'],
    ['First', ['First', 'x'], '(x: indexed_collection<any>)'],
    ['Last', ['Last', 'x'], '(x: indexed_collection<any>)'],
    ['Take', ['Take', 'x', 2], '(x: indexed_collection<any>)'],
    ['Drop', ['Drop', 'x', 1], '(x: indexed_collection<any>)'],
    ['Sum', ['Sum', 'x'], '(x: collection)'],
    ['Mean', ['Mean', 'x'], '(x: collection<number> | value)'],
    ['Max', ['Max', 'x'], '(x: collection<any> | value)'],
    ['Count', ['Count', 'x'], '(x: collection<any>)'],
    ['At', ['At', 'x', 1], '(x: dictionary<any> | indexed_collection<any>)'],
    ['Rest', ['Rest', 'x'], '(x: indexed_collection<any>)'],
    ['Unique', ['Unique', 'x'], '(x: collection<any>)'],
    ['Contains', ['Contains', 'x', 2], '(x: collection<any>)'],
    ['IndexOf', ['IndexOf', 'x', 2], '(x: indexed_collection<any>)'],
    [
      'Filter',
      ['Filter', 'x', ['Function', ['Greater', 'k', 1], 'k']],
      '(x: collection<unknown>)',
    ],
    ['Join', ['Join', 'x', 'x'], '(x: collection<any>)'],
    ['Spread', ['List', ['Spread', 'x'], 0], '(x: collection<any>)'],
    ['Dot', ['Dot', 'x', 'x'], '(x: list<tuple> | matrix | tuple | vector)'],
  ])('%s', (_name, use, type) => {
    const { types, values } = both(use);
    expect(types).toEqual([type, type]);
    const [a, b] = values as [unknown[], unknown[]];
    expect(a[0]).toBe('Tuple');
    expect([a[2], a[1]]).toEqual([b[1], b[2]]);
    expect(a[1]).toEqual(['List', 6, 2, 4]);
  });

  // `Range` requires one number and does not map: `n` stays a number, and
  // `Sort(n)` is refused, as before CE-1270.
  test('Range(n) first: Sort(n) is refused, as before', () => {
    const ce = new ComputeEngine();
    const t = ce
      .box(['Function', ['Tuple', ['Range', 'x'], ['Sort', 'x']], 'x'] as any)
      .type.toString();
    expect(t).toBe('error');
  });
});

describe('CE-1270: the starting types are kept only during one boxing', () => {
  const BODY = ['Tuple', COMM, ['Determinant', 'A'], ['Determinant', 'B']];
  test('one raw body boxed by two independent calls', () => {
    const ce = new ComputeEngine();
    const raw = ce.box(BODY as any, { form: 'raw' });
    const lit = () =>
      ce.function('Function', [raw, ce.symbol('A'), ce.symbol('B')]);
    const first = lit();
    const second = lit();
    const fresh = new ComputeEngine().box(['Function', BODY, 'A', 'B'] as any);
    for (const f of [first, second]) {
      expect(f.type.toString()).toBe(fresh.type.toString());
      expect(f.json).toEqual(fresh.json);
      expect(ce.box(['Apply', f, A, B] as any).evaluate().json).toEqual([
        'Tuple',
        ['List', ...COMM_VALUE],
        -2,
        -1,
      ]);
    }
  });

  test('a fold whose accumulator type changes between steps', () => {
    const ce = new ComputeEngine();
    const combiner = [
      'Function',
      ['Join', 'acc', ['List', ['Sum', ['Add', 'x', 'x']], ['Length', 'x']]],
      'acc',
      'x',
    ];
    const L = ['List', ['List', 1, 2], ['List', 3, 4, 5]];
    expect(
      ce.box(['Fold', combiner, ['List'], L] as any).evaluate().json
    ).toEqual(['List', 6, 2, 24, 3]);
  });
});

// `a_{n+1}` keeps a subscript with an untyped base, so that `a` can be a
// number: the type and the canonical form are those of the base
// (be4c7f709).
describe('CE-1270: a subscript of a parameter after a number use', () => {
  const expected = [
    'Function',
    [
      'Block',
      ['Tuple', ['Multiply', 2, 'a'], ['Subscript', 'a', ['Add', 'n', 1]]],
    ],
    'a',
  ];
  test('LaTeX', () => {
    const f = new ComputeEngine().parse('a \\mapsto (2a, a_{n+1})');
    expect(f.type.toString()).toBe('(a: unknown) -> tuple<number, unknown>');
    expect(f.json).toEqual(expected);
  });
  test('MathJSON', () => {
    const f = new ComputeEngine().box([
      'Function',
      ['Tuple', ['Multiply', 2, 'a'], ['Subscript', 'a', ['Add', 'n', 1]]],
      'a',
    ] as any);
    expect(f.type.toString()).toBe('(a: unknown) -> tuple<number, unknown>');
    expect(f.json).toEqual(expected);
  });
});
