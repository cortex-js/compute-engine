/**
 * CE-1583: an element-wise application over an operand declared
 * `indexed_collection<number>` is typed `indexed_collection<…>`, not
 * `list<…>`.
 *
 * Such an operand can hold a list or a point. A head that maps a point to a
 * point (`Divide`, `Multiply`, `Sin`, `Mod`) gives a point for a point, so
 * `list<…>` did not hold the value of `u/5` for `u := (1, 2)`.
 *
 * A point divided by `NaN` is the point of `NaN` coordinates, as a point
 * multiplied by `NaN` is. Before, `(1, 2) / NaN` was the scalar `NaN`, so
 * `u / s` for `u := (1, 2)` and `s := NaN` gave a value that its type
 * `indexed_collection<number>` does not hold. A literal `NaN` divisor of a
 * numerator that is not typed as a point still folds the quotient to `NaN`
 * at boxing, and the type of that quotient is `NaN`.
 */

import { ComputeEngine } from '../../src/compute-engine';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('u', 'indexed_collection<number>');
  ce.declare('s', 'number');
  return ce;
}

describe('CE-1583: the lift over an indexed_collection<number> operand', () => {
  test.each([
    [['Divide', 'u', 5], 'indexed_collection<number>'],
    [['Divide', 'u', 's'], 'indexed_collection<number>'],
    [['Multiply', 'u', 's'], 'indexed_collection<number>'],
    [['Negate', 'u'], 'indexed_collection<number>'],
    [['Sin', 'u'], 'indexed_collection<number>'],
    [['Power', 'u', 2], 'indexed_collection<number>'],
    [['Mod', ['Divide', 'u', 5], 1], 'indexed_collection<nan | real>'],
  ])('%j is typed %s', (json, expected) => {
    const ce = engine();
    expect(ce.box(json as never).type.toString()).toBe(expected);
  });

  test('the literal quotient is a Multiply and keeps the same type', () => {
    const ce = engine();
    const q = ce.box(['Divide', 'u', 5]);
    expect(q.operator).toBe('Multiply');
    expect(q.type.toString()).toBe('indexed_collection<number>');
  });

  test.each([
    [['Divide', 'u', 5]],
    [['Divide', 'u', 's']],
    [['Sin', 'u']],
    [['Mod', ['Divide', 'u', 5], 1]],
  ])('the value of %j matches its type for a point and a list', (json) => {
    const ce = engine();
    ce.assign('s', 5);
    const q = ce.box(json as never);
    ce.assign('u', ['Tuple', 1, 2]);
    const point = q.N();
    expect(point.operator).toBe('Tuple');
    expect(point.type.matches(q.type)).toBe(true);
    ce.assign('u', ['List', 1, 2]);
    const list = q.N();
    expect(list.operator).toBe('List');
    expect(list.type.matches(q.type)).toBe(true);
  });

  test('a declared list keeps its list type', () => {
    const ce = new ComputeEngine();
    ce.declare('v', 'list<number>');
    expect(ce.box(['Divide', 'v', 5]).type.toString()).toBe('list<number>');
  });
});

describe('CE-1583: a point divided by NaN', () => {
  test('the literal quotient is the point of NaN coordinates', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Divide', ['Tuple', 1, 2], 'NaN']).json).toEqual([
      'Tuple',
      'NaN',
      'NaN',
    ]);
  });

  test('div() gives the point of NaN coordinates', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Tuple', 1, 2]).div(ce.NaN).json).toEqual([
      'Tuple',
      'NaN',
      'NaN',
    ]);
  });

  test('a divisor whose value is NaN gives a point for a point numerator', () => {
    const ce = engine();
    const q = ce.box(['Divide', 'u', 's']);
    ce.assign('s', NaN);
    ce.assign('u', ['Tuple', 1, 2]);
    const point = q.N();
    expect(point.json).toEqual(['Tuple', 'NaN', 'NaN']);
    expect(point.type.matches(q.type)).toBe(true);
    ce.assign('u', ['List', 1, 2]);
    const list = q.N();
    expect(list.json).toEqual(['List', 'NaN', 'NaN']);
    expect(list.type.matches(q.type)).toBe(true);
  });

  test('a point with an absent coordinate divided by NaN: both routes agree', () => {
    const ce = new ComputeEngine();
    const p = ['Tuple', 1, 'Missing'];
    const boxed = ce.box(['Divide', p, 'NaN'] as never).json;
    expect(boxed).toEqual(['Tuple', 'NaN', 'NaN']);
    expect(ce.box(p as never).div(ce.NaN).json).toEqual(boxed);
  });

  test('a symbol typed as a point, with no value, divided by NaN is NaN', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'tuple<real, real>');
    const r = ce.box(['Divide', 'q', 'NaN']);
    expect(r.json).toBe('NaN');
    expect(r.N().type.matches(r.type)).toBe(true);
  });

  // The answer at HEAD before CE-1583 is kept: the quotient folds to `NaN`.
  test('a tuple with list coordinates divided by NaN is NaN on both routes', () => {
    const ce = new ComputeEngine();
    const zipped = ['Tuple', ['List', 1, 2], ['List', 3, 4]];
    expect(ce.box(['Divide', zipped, 'NaN'] as never).json).toBe('NaN');
    expect(ce.box(zipped as never).div(ce.NaN).json).toBe('NaN');
  });

  test('NaN divided by a scalar is still NaN', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Divide', 'NaN', 2]).json).toBe('NaN');
    expect(ce.box(['Divide', 2, 'NaN']).json).toBe('NaN');
  });
});
