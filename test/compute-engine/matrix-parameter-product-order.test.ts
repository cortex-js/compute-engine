/**
 * A product of two parameters that can hold matrices keeps its written
 * order, so the commutator `a·b − b·a` of two matrices that do not commute
 * is not `0`.
 *
 * - CE-1490: a parameter annotated `expression` receives a matrix whole
 *   (`docs/BROADCAST-MODEL.md`), so it can be a matrix factor
 *   (`typeMayHoldMatrix()`, `matrix-operand.ts`).
 * - CE-1491: a literal assigned to a name declared with a signature whose
 *   parameters can hold matrices has those parameters typed by the
 *   declaration before its body is canonicalized
 *   (`declarationTypedFunctionLiteral()`, `function-utils.ts`).
 * - CE-1494: a bare parameter that a later use types as a matrix
 *   (`Determinant(a)`) makes the body box again when it has a product
 *   (`typesToBoxAgain()`, `function-utils.ts`), also when the product reads
 *   the parameter through another operator (`Transpose(a)`).
 */
import { ComputeEngine } from '../../src/compute-engine';

const A = ['List', ['List', 1, 2], ['List', 3, 4]];
const B = ['List', ['List', 0, 1], ['List', 1, 0]];
const COMM = ['Subtract', ['Multiply', 'a', 'b'], ['Multiply', 'b', 'a']];
// A·B − B·A
const COMM_VALUE = [
  'List',
  ['List', -1, -3],
  ['List', 3, 1],
];

describe('CE-1490: parameters annotated expression', () => {
  test('the commutator of two matrices', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      COMM,
      ['Typed', 'a', "'expression'"],
      ['Typed', 'b', "'expression'"],
    ] as any);
    expect(ce.box(['Apply', f, A, B] as any).evaluate().json).toEqual(
      COMM_VALUE
    );
  });

  test('a transparent alias of expression', () => {
    const ce = new ComputeEngine();
    ce.declareType('Expr', 'expression', { alias: true });
    const f = ce.box([
      'Function',
      COMM,
      ['Typed', 'a', "'Expr'"],
      ['Typed', 'b', "'Expr'"],
    ] as any);
    expect(ce.box(['Apply', f, A, B] as any).evaluate().json).toEqual(
      COMM_VALUE
    );
  });

  test('a product of numbers is still sorted', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      COMM,
      ['Typed', 'a', "'expression'"],
      ['Typed', 'b', "'expression'"],
    ] as any);
    expect(ce.box(['Apply', f, 3, 5] as any).evaluate().json).toEqual(0);
  });
});

describe('CE-1491: a literal assigned to a declared matrix signature', () => {
  test('raw literal', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(matrix, matrix) -> matrix');
    ce.assign('g', ['Function', COMM, 'a', 'b'] as any);
    expect(ce.box(['g', A, B] as any).evaluate().json).toEqual(COMM_VALUE);
  });

  test('boxed literal', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(matrix, matrix) -> matrix');
    ce.assign('g', ce.box(['Function', COMM, 'a', 'b'] as any));
    expect(ce.box(['g', A, B] as any).evaluate().json).toEqual(COMM_VALUE);
  });

  test('declaration with an evaluate literal', () => {
    const ce = new ComputeEngine();
    ce.declare('g', {
      signature: '(matrix, matrix) -> matrix',
      evaluate: ['Function', COMM, 'a', 'b'] as any,
    });
    expect(ce.box(['g', A, B] as any).evaluate().json).toEqual(COMM_VALUE);
  });

  test('a declared expression signature', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(expression, expression) -> expression');
    ce.assign('g', ['Function', COMM, 'a', 'b'] as any);
    expect(ce.box(['g', A, B] as any).evaluate().json).toEqual(COMM_VALUE);
  });

  test('a declared any signature keeps the reading of an untyped parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(any) -> any');
    ce.assign('g', ['Function', ['Divide', 'x', 'x'], 'x'] as any);
    expect(ce.box(['g', 5] as any).evaluate().json).toEqual(1);
  });

  test('a numeric signature keeps the reading of an untyped parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(real, real) -> real');
    ce.assign('g', ['Function', COMM, 'a', 'b'] as any);
    expect(ce.box(['g', 2, 3] as any).evaluate().json).toEqual(0);
  });
});

describe('CE-1494: a matrix use after the product', () => {
  const DETS = [
    ['Determinant', 'a'],
    ['Determinant', 'b'],
  ];
  function first(wrap: (x: string) => unknown): unknown {
    const ce = new ComputeEngine();
    const a = wrap('a');
    const b = wrap('b');
    const comm = ['Subtract', ['Multiply', a, b], ['Multiply', b, a]];
    const f = ce.box(['Function', ['Tuple', comm, ...DETS], 'a', 'b'] as any);
    const v = ce.box(['Apply', f, A, B] as any).evaluate().json as unknown[];
    return v[1];
  }

  test('Transpose', () => {
    // Aᵀ·Bᵀ − Bᵀ·Aᵀ
    expect(first((x) => ['Transpose', x])).toEqual([
      'List',
      ['List', 1, -3],
      ['List', 3, -1],
    ]);
  });

  test('Block', () => {
    expect(first((x) => ['Block', x])).toEqual(COMM_VALUE);
  });

  test('First of a list', () => {
    expect(first((x) => ['First', ['List', x]])).toEqual(COMM_VALUE);
  });

  test('bare parameters', () => {
    expect(first((x) => x)).toEqual(COMM_VALUE);
  });

  test('two different operators of one parameter', () => {
    const ce = new ComputeEngine();
    const ct = ['ConjugateTranspose', 'a'];
    const t = ['Transpose', 'a'];
    const f = ce.box([
      'Function',
      [
        'Tuple',
        ['Subtract', ['Multiply', ct, t], ['Multiply', t, ct]],
        ['Determinant', 'a'],
      ],
      'a',
    ] as any);
    expect(f.toString()).toBe(
      '(a) => (ConjugateTranspose(a) * Transpose(a) - Transpose(a) * ConjugateTranspose(a), Determinant(a))'
    );
  });

  test('a product of untyped names with no matrix use is sorted', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', COMM, 'a', 'b'] as any);
    expect(f.toString()).toBe('(a, b) => a * b - a * b');
  });
});
