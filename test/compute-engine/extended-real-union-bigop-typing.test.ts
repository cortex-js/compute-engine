/**
 * CE owes a narrow result type for what it returns (ARCHITECTURE.md, "Who
 * provides a type"). A host reads `number` as possibly complex, so an
 * operation on values of the extended real line must not widen to it.
 *
 * - A broadcast over a scalar-or-list union operand (`v: real | list<real>`)
 *   types each cell from the union's cell type (`scalarOrListUnionCellType`
 *   in `collection-utils.ts`): `2v` is `list<real> | real`, not
 *   `list<number> | number`.
 * - `Sum` and `Product` over an index range type the result from the body
 *   (`bigOpOverDomainType` in `library/type-handlers.ts`): a finite range
 *   gives the reduction's tier, an unbounded one adds `±∞` and NaN.
 * - A function expression whose operator has no sign rule reads its sign
 *   from a ranged result type (`sgn()` in `boxed-expression/sgn.ts`).
 */

import { ComputeEngine } from '../../src/compute-engine';

const INF = { num: '+Infinity' };

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('y', 'real | signed_infinity | nan');
  ce.declare('u', 'real | signed_infinity | list<real>');
  ce.declare('v', 'real | list<real>');
  ce.declare('r', 'real');
  return ce;
}

describe('A BROADCAST OVER A SCALAR-OR-LIST UNION KEEPS THE CELL TYPE', () => {
  test.each([
    [['Multiply', 'r', 'v'], 'list<real> | real'],
    [['Add', 'r', 'v'], 'list<real> | real'],
    [['Multiply', 2, 'v'], 'list<real> | real'],
    [['Sin', 'v'], 'list<real> | real'],
    [
      ['Multiply', 'y', 'u'],
      'list<nan | real | signed_infinity> | nan | real | signed_infinity',
    ],
    [
      ['Add', 'y', 'u'],
      'list<nan | real | signed_infinity> | nan | real | signed_infinity',
    ],
  ])('%j', (expr, expected) => {
    const ce = engine();
    expect(ce.box(expr as never).type.toString()).toBe(expected);
  });

  test('each branch of the value is a member of the type', () => {
    const ce = engine();
    const e = ce.box(['Multiply', 2, 'v'] as never);
    for (const value of [3, ['List', 1, 2]]) {
      ce.assign('v', ce.box(value as never));
      expect(e.evaluate().type.matches(e.type)).toBe(true);
    }
  });
});

describe('SUM AND PRODUCT OVER AN INDEX RANGE ARE TYPED FROM THE BODY', () => {
  test.each([
    [['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 10]], 'integer'],
    [['Product', ['Add', 'k', 1], ['Limits', 'k', 1, 5]], 'integer'],
    [['Product', ['Divide', 1, 'k'], ['Limits', 'k', 1, 4]], 'rational'],
    [['Sum', ['Sqrt', 'k'], ['Limits', 'k', 1, 3]], 'real'],
    [['Sum', ['Power', 'k', 2], ['Element', 'k', ['Range', 1, 10]]], 'integer'],
    [
      ['Sum', ['Multiply', 'y', 'k'], ['Limits', 'k', 1, 10]],
      'nan | real | signed_infinity',
    ],
    [
      ['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 1, INF]],
      'nan | real | signed_infinity',
    ],
    [
      ['Sum', ['Power', -1, 'k'], ['Limits', 'k', 1, INF]],
      'integer | nan | signed_infinity',
    ],
    // A `list` type alone does not prove a finite length: this `Filter` of
    // an infinite range is typed `list` and is infinite.
    [
      [
        'Sum',
        'k',
        [
          'Element',
          'k',
          ['Filter', ['Range', 1, INF], ['Function', ['Greater', '_', 5], '_']],
        ],
      ],
      'integer | nan | signed_infinity',
    ],
    [
      ['Sum', ['Power', 'k', 2], ['Element', 'k', ['List', 1, 2, 3]]],
      'integer',
    ],
    // A complex body keeps the wide type.
    [
      ['Sum', ['Multiply', 'ImaginaryUnit', 'k'], ['Limits', 'k', 1, 10]],
      'number',
    ],
  ])('%j', (expr, expected) => {
    const ce = engine();
    expect(ce.box(expr as never).type.toString()).toBe(expected);
  });

  test('the value is a member of the type', () => {
    const ce = engine();
    for (const expr of [
      ['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 10]],
      ['Sum', ['Power', 'k', 2], ['Limits', 'k', 5, 1]],
      ['Sum', ['Divide', 1, ['Power', 'k', 2]], ['Limits', 'k', 1, INF]],
    ]) {
      const e = ce.box(expr as never);
      expect(e.evaluate().type.matches(e.type)).toBe(true);
    }
  });
});

describe('A RANGED RESULT TYPE GIVES THE SIGN', () => {
  test.each([
    [['Subtract', 1, 't'], 'positive'],
    [['Clamp', 't', -1, 1], 'positive'],
  ])('%j', (expr, sign) => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real<0.9985..0.9999>');
    const e = ce.box(expr as never);
    expect(e.sgn).toBe(sign);
    expect(e.isNonNegative).toBe(true);
  });

  test('a type that admits NaN gives no sign', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'real | nan');
    expect(ce.box(['Clamp', 'q', 0, 1] as never).sgn).toBeUndefined();
  });
});

// User decision 2026-09-26: `Abs` keeps a `nan` member when its operand may
// be NaN (|NaN| is NaN), and `Real`, `Imaginary` and `Arg` are typed member
// by member instead of the wide `number`.
describe('ABS, REAL, IMAGINARY AND ARG OF AN OPERAND THAT MAY BE NAN', () => {
  test.each([
    [['Abs', 'q'], 'nan | real<0..>'],
    [['Abs', ['Arccos', 'q']], 'nan | real<0..>'],
    [['Abs', 'x'], 'real<0..>'],
    [['Abs', 'w'], 'nan | real<0..> | signed_infinity'],
    [['Real', ['Arccos', 'q']], 'nan | real'],
    [['Real', 'z'], 'nan | real'],
    [['Imaginary', 'z'], 'nan | real'],
    [['Arg', 'z'], 'nan | real'],
    [['Real', 'w'], 'nan | real | signed_infinity'],
    [['Real', 'x'], 'real'],
  ])('%j', (expr, expected) => {
    const ce = new ComputeEngine();
    ce.declare('q', 'real | nan');
    ce.declare('z', 'complex | nan');
    ce.declare('x', 'real');
    ce.declare('w', 'number');
    expect(ce.box(expr as never).type.toString()).toBe(expected);
  });

  test('every value of a `number` operand is a member of the type', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'number');
    const values = [
      ce.NaN,
      ce.ComplexInfinity,
      ce.PositiveInfinity,
      ce.box(['Complex', 1, 2]),
      ce.box(['Add', { num: '+Infinity' }, 'ImaginaryUnit']),
    ];
    for (const v of values) {
      ce.assign('w', v);
      for (const head of ['Abs', 'Real', 'Imaginary', 'Arg']) {
        const e = ce.box([head, 'w'] as never);
        expect(e.evaluate().type.matches(e.type)).toBe(true);
      }
    }
  });
});
