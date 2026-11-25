import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// CE-1495. `1^b` folds to `1` at canonicalization only when the exponent is
// not a collection by its type. The power of a number by a collection is
// element-wise: `1^M` with `M` a 2×2 matrix is a 2×2 matrix of ones, not the
// scalar `1`. A generic exponent (`1^x` with `x` undeclared, `1^{n+1}`) still
// folds, as documented in ARCHITECTURE.md ("Generic-symbol conventions").

const A: MathJsonExpression = ['List', ['List', 1, 2], ['List', 3, 4]];
const ONES = ['List', ['List', 1, 1], ['List', 1, 1]];

describe('1^b WITH A COLLECTION EXPONENT KEEPS THE SHAPE', () => {
  test.each([
    ['matrix<2x2>', 'matrix<2x2>'],
    ['list<integer>', 'list<number>'],
    ['vector<3>', 'vector<3>'],
  ])('1^M with M: %s keeps the power', (type, resultType) => {
    const ce = new ComputeEngine();
    ce.declare('M', type);
    const p = ce.expr(['Power', 1, 'M']);
    expect(p.json).toEqual(['Power', 1, 'M']);
    expect(p.type.toString()).toBe(resultType);
  });

  test('1^M evaluates to a matrix of ones when M has a value', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix<2x2>');
    const p = ce.expr(['Power', 1, 'M']);
    ce.assign('M', ce.expr(A));
    expect(p.evaluate().json).toEqual(ONES);
  });

  test('a literal matrix exponent', () => {
    const ce = new ComputeEngine();
    expect(ce.expr(['Power', 1, A]).evaluate().json).toEqual(ONES);
  });

  test.each([
    [
      'the parameter is typed by an earlier use',
      ['Tuple', ['Determinant', 'x'], ['Power', 1, 'x']],
      ['Tuple', -2, ONES],
    ],
    [
      'the parameter is typed by a later use',
      ['Tuple', ['Power', 1, 'x'], ['Determinant', 'x']],
      ['Tuple', ONES, -2],
    ],
  ] as [string, MathJsonExpression, unknown][])(
    'in a function literal, %s',
    (_, body, expected) => {
      const ce = new ComputeEngine();
      const f = ce.expr(['Function', body, 'x']);
      expect(ce.expr(['Apply', f, A]).evaluate().json).toEqual(expected);
    }
  );
});

describe('1^b WITH A GENERIC EXPONENT STILL FOLDS', () => {
  test.each([
    ['y', 'y'],
    ['n+1', ['Add', 'n', 1]],
    ['a real symbol', 'r'],
  ] as [string, MathJsonExpression][])('1^(%s) is 1', (_, exponent) => {
    const ce = new ComputeEngine();
    ce.declare('r', 'real');
    expect(ce.expr(['Power', 1, exponent]).json).toBe(1);
  });
});
