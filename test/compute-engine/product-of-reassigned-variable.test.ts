import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json';

// A `Product` with no indexing set over a collection is canonicalized as
// `Reduce(body, Multiply, 1)` (`canonicalBigop`, `library/utils.ts`). For a
// variable, the test of "is a collection" read the value the variable held
// when the expression was boxed. After the variable was assigned a scalar,
// the outdated `Reduce` form gave an `incompatible-type` error, while the
// same `Product` boxed after the assignment gave the scalar. A variable that
// can be assigned a value that is not a collection (an inferred type, or a
// declared type that is not a collection type) now keeps the `Product` head,
// and its value is read at evaluation time. A variable declared with a
// collection type always holds a collection and is still rewritten.

type Value = MathJsonExpression | number;

function evaluateAfterReassignment(
  op: string,
  first: Value,
  second: Value,
  declared?: string
): { late: string; fresh: string } {
  const ce = new ComputeEngine();
  if (declared !== undefined) ce.declare('x', declared);
  ce.assign('x', ce.box(first));
  const expr = ce.box([op, 'x']);
  ce.assign('x', ce.box(second));
  return {
    late: expr.evaluate().toString(),
    fresh: ce.box([op, 'x']).evaluate().toString(),
  };
}

describe('A big operator boxed before a variable is assigned again', () => {
  test('Product: list, then a scalar', () => {
    expect(
      evaluateAfterReassignment('Product', ['List', 1, 2], 5, 'any')
    ).toEqual({ late: '5', fresh: '5' });
  });

  test('Product: a scalar, then a list', () => {
    expect(
      evaluateAfterReassignment('Product', 5, ['List', 3, 4], 'any')
    ).toEqual({ late: '12', fresh: '12' });
  });

  test('Product: list, then a scalar, with no declaration', () => {
    expect(
      evaluateAfterReassignment('Product', ['List', 1, 2], 5)
    ).toEqual({ late: '5', fresh: '5' });
  });

  test('Product: list, then another list', () => {
    expect(
      evaluateAfterReassignment('Product', ['List', 1, 2], ['List', 3, 4, 5])
    ).toEqual({ late: '60', fresh: '60' });
  });

  for (const op of ['Sum', 'Max', 'Length', 'Count']) {
    test(`${op}: the boxed expression agrees with one boxed later`, () => {
      for (const [first, second] of [
        [['List', 1, 2], 5],
        [5, ['List', 1, 2]],
      ] as [Value, Value][]) {
        const { late, fresh } = evaluateAfterReassignment(
          op,
          first,
          second,
          'any'
        );
        expect(late).toBe(fresh);
      }
    });
  }
});

// The product of a list of square matrices is their matrix product. A
// variable with no declaration that holds a list of two 2x2 matrices is
// typed `tensor<integer^(2x2x2)>`, and the product of such a tensor was
// typed `number`: a compiled parent read the matrix as one number, and the
// compilation of the `Product` refused it ("the shape of the result is not
// known"). M·Q = [[1, 2], [3, 4]]·[[0, 1], [1, 0]] = [[2, 1], [4, 3]].
describe('Product of a list of matrices held by a variable', () => {
  const M: MathJsonExpression = [
    'List',
    ['List', 1, 2],
    ['List', 3, 4],
  ];
  const Q: MathJsonExpression = [
    'List',
    ['List', 0, 1],
    ['List', 1, 0],
  ];

  function check(ce: ComputeEngine, expr: ReturnType<ComputeEngine['box']>) {
    expect(ce.box('L').type.toString()).toBe('tensor<integer^(2x2x2)>');
    expect(expr.type.toString()).toBe('matrix<integer^(2x2)>');
    expect(expr.evaluate().toString()).toBe('[[2,1],[4,3]]');
    const r = compile(expr, { to: 'javascript', fallback: false });
    expect(r.run!({} as never)).toEqual([
      [2, 1],
      [4, 3],
    ]);
  }

  test('assigned, then boxed', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', M, Q]));
    check(ce, ce.box(['Product', 'L']));
  });

  test('boxed, then assigned', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Product', 'L']);
    ce.assign('L', ce.box(['List', M, Q]));
    check(ce, expr);
  });

  test('the Reduce form has the same type', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', M, Q]));
    expect(ce.box(['Reduce', 'L', 'Multiply', 1]).type.toString()).toBe(
      'matrix<integer^(2x2)>'
    );
  });

  // Elements whose product the type rules do not describe are typed
  // `unknown`, as the `Reduce` form is, not `number`.
  test.each([
    ['a tensor of rank 4', ['List', ['List', M, M], ['List', Q, Q]]],
    [
      'a ragged list of matrices and rows',
      ['List', ['List', M, ['List', 5]], ['List', Q, ['List', 2]]],
    ],
  ] as [string, MathJsonExpression][])('%s', (_, value) => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(value));
    const expr = ce.box(['Product', 'L']);
    expect(expr.type.toString()).toBe('unknown');
    expect(expr.evaluate().isCollection).toBe(true);
  });
});

describe('Canonical form of a Product with no indexing set', () => {
  test('a variable declared any keeps the Product head', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'any');
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    const expr = ce.box(['Product', 'L']);
    expect(expr.json).toEqual(['Product', 'L']);
    expect(expr.evaluate().toString()).toBe('6');
    expect(expr.N().toString()).toBe('6');
  });

  test('a variable with an inferred type keeps the Product head', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    const expr = ce.box(['Product', 'L']);
    expect(expr.json).toEqual(['Product', 'L']);
    expect(expr.evaluate().toString()).toBe('6');
  });

  test('a variable declared with a list type is still rewritten', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<integer>');
    ce.assign('L', ce.box(['List', 1, 2, 3]));
    const expr = ce.box(['Product', 'L']);
    expect(expr.json).toEqual(['Reduce', 'L', 'Multiply', 1]);
    expect(expr.evaluate().toString()).toBe('6');
  });

  test('a list literal is still rewritten as a Reduce', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Product', ['List', 1, 2, 3]]).json).toEqual([
      'Reduce',
      ['List', 1, 2, 3],
      'Multiply',
      1,
    ]);
  });

  test('a constant collection symbol is still rewritten as a Reduce', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Product', 'Integers']).json).toEqual([
      'Reduce',
      'Integers',
      'Multiply',
      1,
    ]);
  });
});

// `Product` multiplies the elements starting from `1`, so a list of one
// matrix that is not square multiplies to that matrix. The product of two
// such matrices is not defined, and the type stays `number`.
describe('The type of the Product of matrices that are not square', () => {
  const m: MathJsonExpression = [
    'List',
    ['List', 1, 2, 3],
    ['List', 4, 5, 6],
  ];

  test('a list of one 2x3 matrix: the type holds the value', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 'x', "'unknown'", ['List', m]],
      ['Product', 'x'],
    ]);
    expect(expr.type.toString()).toBe('matrix<integer^(2x3)>');
    const value = expr.evaluate();
    expect(value.toString()).toBe('[[1,2,3],[4,5,6]]');
    expect(value.type.matches(expr.type)).toBe(true);
  });

  test('a list of two 2x3 matrices: the type is unchanged', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 'x', "'unknown'", ['List', m, m]],
      ['Product', 'x'],
    ]);
    expect(expr.type.toString()).toBe('number');
  });

  // Elements of several shapes can multiply to a matrix: a 2x3 and a 3x2
  // matrix give a 2x2 matrix, and a number times a 2x3 matrix is a 2x3
  // matrix. The type must hold that value.
  test.each<[string, MathJsonExpression]>([
    [
      'a 2x3 and a 3x2 matrix',
      [
        'List',
        m,
        ['List', ['List', 1, 0], ['List', 0, 1], ['List', 1, 1]],
      ],
    ],
    ['a number and a 2x3 matrix', ['List', 2, m]],
    // An absent element is not a matrix, so no two matrices are multiplied.
    ['a 2x3 matrix and an absent element', ['List', m, 'Missing']],
  ])('%s: the type holds the value', (_, list) => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Block', ['Assign', 'x', list], ['Product', 'x']]);
    const value = expr.evaluate();
    expect(value.type.matches(expr.type)).toBe(true);
    expect(expr.type.toString()).not.toBe('number');
  });
});
